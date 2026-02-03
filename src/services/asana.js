/**
 * Asana Service
 *
 * Maneja todas las interacciones con la API de Asana.
 * Usa SDK de Asana v3.x
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 1.5
 */

const Asana = require('asana');

// APIs de Asana (v3.x usa clases separadas)
let usersApi = null;
let workspacesApi = null;
let projectsApi = null;
let tasksApi = null;
let initialized = false;

/**
 * Inicializa el cliente de Asana v3.x
 */
function initClient() {
  if (!initialized) {
    const pat = process.env.ASANA_PAT;
    if (!pat) {
      throw new Error('ASANA_PAT no configurado');
    }

    // Configurar autenticación con token
    const client = Asana.ApiClient.instance;
    const token = client.authentications['token'];
    token.accessToken = pat;

    // Crear instancias de las APIs
    usersApi = new Asana.UsersApi();
    workspacesApi = new Asana.WorkspacesApi();
    projectsApi = new Asana.ProjectsApi();
    tasksApi = new Asana.TasksApi();

    initialized = true;
  }
}

/**
 * Normaliza texto para comparación (quita acentos y pasa a minúsculas)
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Quita acentos
}

/**
 * Obtiene proyectos donde el usuario es responsable (campo custom "Responsable Proyecto")
 * NOTA: Esta búsqueda es lenta (~19 min para 1400 proyectos) porque Asana no permite
 * filtrar por custom fields. Para uso frecuente, los resultados se cachean en DynamoDB.
 *
 * @param {string} userName - Nombre del usuario como aparece en Asana (ej: "Harold Gomez")
 * @returns {Array<{gid: string, name: string}>}
 */
async function getProjectsForUser(userName) {
  try {
    initClient();

    const normalizedUserName = normalizeText(userName);
    console.log(`[Asana] Buscando proyectos para: "${userName}" (normalizado: "${normalizedUserName}")`);

    // Obtener workspaces
    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspacesList = workspacesResponse.data || [];

    console.log(`[Asana] Workspaces: ${workspacesList.length}`);

    const projects = [];
    let totalChecked = 0;

    for (const workspace of workspacesList) {
      try {
        // Obtener proyectos con paginación
        let offset = null;
        let pageCount = 0;

        do {
          const params = { limit: 100, opt_fields: 'name,archived' };
          if (offset) params.offset = offset;

          const projectsResponse = await projectsApi.getProjectsForWorkspace(workspace.gid, params);
          const projectList = projectsResponse.data || [];
          pageCount++;

          console.log(`[Asana] Página ${pageCount}: ${projectList.length} proyectos`);

          for (const project of projectList) {
            if (project.archived) continue;

            try {
              const detailResponse = await projectsApi.getProject(project.gid, {
                opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
              });

              const customFields = detailResponse.data?.custom_fields || [];
              const responsableField = customFields.find(
                cf => cf.name === 'Responsable Proyecto'
              );

              if (responsableField && responsableField.display_value) {
                const normalizedResponsable = normalizeText(responsableField.display_value);

                // Comparar nombres normalizados (exacto)
                if (normalizedResponsable === normalizedUserName) {
                  console.log(`[Asana] MATCH: ${project.name}`);
                  projects.push({ gid: project.gid, name: project.name });
                }
              }
            } catch (detailError) {
              // Ignorar errores de proyectos individuales (403, etc.)
            }

            totalChecked++;
            if (totalChecked % 100 === 0) {
              console.log(`[Asana] Revisados: ${totalChecked} proyectos, encontrados: ${projects.length}`);
            }

            await sleep(25); // Rate limiting
          }

          // IMPORTANTE: En Asana SDK v3.x, next_page está en _response
          offset = projectsResponse._response?.next_page?.offset || null;

        } while (offset);

      } catch (wsError) {
        console.error(`[Asana] Error en workspace ${workspace.gid}:`, wsError.message);
      }

      await sleep(50);
    }

    console.log(`[Asana] Búsqueda completada: ${projects.length} proyectos para "${userName}"`);
    return projects;
  } catch (error) {
    console.error('[Asana] Error obteniendo proyectos:', error);
    throw error;
  }
}

/**
 * Obtiene detalles de un proyecto
 * @param {string} projectGid
 * @returns {Object}
 */
async function getProjectDetails(projectGid) {
  try {
    initClient();
    const response = await projectsApi.getProject(projectGid, {
      opt_fields: 'gid,name,owner,custom_fields,current_status'
    });
    const project = response.data;

    return {
      gid: project.gid,
      name: project.name,
      owner: project.owner,
      status: project.current_status?.text || null,
      customFields: project.custom_fields || []
    };
  } catch (error) {
    console.error(`Error obteniendo detalles del proyecto ${projectGid}:`, error);
    throw error;
  }
}

/**
 * Busca un usuario de Asana por email
 * @param {string} email
 * @returns {Object|null}
 */
async function getUserByEmail(email) {
  try {
    initClient();

    // Obtener todos los workspaces
    const workspacesResponse = await workspacesApi.getWorkspaces({});

    for (const workspace of workspacesResponse.data || []) {
      try {
        // Buscar usuario en el workspace
        const usersResponse = await usersApi.getUsersForWorkspace(workspace.gid, {
          opt_fields: 'gid,name,email'
        });

        for (const user of usersResponse.data || []) {
          if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
            return {
              gid: user.gid,
              name: user.name,
              email: user.email
            };
          }
        }
      } catch (wsError) {
        // Ignorar errores de workspace individuales
        console.log(`No se pudo buscar en workspace ${workspace.gid}`);
      }

      // Rate limiting
      await sleep(100);
    }

    return null;
  } catch (error) {
    console.error('Error buscando usuario por email:', error);
    throw error;
  }
}

/**
 * Verifica que el PAT de Asana es válido
 * @returns {boolean}
 */
async function verifyAccess() {
  try {
    initClient();
    const response = await usersApi.getUser('me', {});
    const me = response.data;
    console.log('Asana auth verificado:', me.gid, me.name);
    return true;
  } catch (error) {
    console.error('Error verificando acceso a Asana:', error);
    return false;
  }
}

/**
 * Obtiene los hitos de un proyecto
 * @param {string} projectGid
 * @returns {Array}
 */
async function getProjectMilestones(projectGid) {
  try {
    initClient();

    // Buscar tareas que sean milestones
    const tasksResponse = await tasksApi.getTasksForProject(projectGid, {
      opt_fields: 'gid,name,due_on,completed,resource_subtype'
    });

    const milestones = [];
    for (const task of tasksResponse.data || []) {
      if (task.resource_subtype === 'milestone') {
        milestones.push({
          gid: task.gid,
          name: task.name,
          dueOn: task.due_on,
          completed: task.completed
        });
      }
    }

    return milestones;
  } catch (error) {
    console.error(`Error obteniendo milestones del proyecto ${projectGid}:`, error);
    return [];
  }
}

/**
 * Función auxiliar para esperar (rate limiting)
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Busca un proyecto por su PMO ID (campo custom "PMO ID")
 * @param {string} pmoId - Ej: "PMO-911"
 * @returns {Object|null}
 */
async function getProjectByPmoId(pmoId) {
  try {
    initClient();

    const pmoIdUpper = pmoId.toUpperCase();
    console.log(`[Asana] Buscando proyecto con PMO ID: ${pmoIdUpper}`);

    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspacesList = workspacesResponse.data || [];

    for (const workspace of workspacesList) {
      try {
        let offset = null;
        let pageCount = 0;

        do {
          const params = { limit: 100, opt_fields: 'name,archived' };
          if (offset) params.offset = offset;

          const projectsResponse = await projectsApi.getProjectsForWorkspace(workspace.gid, params);
          const projectList = projectsResponse.data || [];
          pageCount++;

          for (const project of projectList) {
            if (project.archived) continue;

            try {
              const detailResponse = await projectsApi.getProject(project.gid, {
                opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
              });

              const customFields = detailResponse.data?.custom_fields || [];

              const pmoIdField = customFields.find(
                cf => cf.name && cf.name.toLowerCase().includes('pmo id')
              );

              if (pmoIdField) {
                const fieldValue = (pmoIdField.display_value || '').toUpperCase();
                if (fieldValue === pmoIdUpper) {
                  const responsableField = customFields.find(
                    cf => cf.name === 'Responsable Proyecto'
                  );

                  console.log(`[Asana] Encontrado: ${project.name}`);
                  return {
                    gid: project.gid,
                    name: project.name,
                    pmoId: fieldValue,
                    responsable: responsableField?.display_value || 'No asignado',
                    status: null,
                    customFields: customFields
                  };
                }
              }
            } catch (detailError) {
              // Ignorar errores de proyectos individuales
            }

            await sleep(25);
          }

          // IMPORTANTE: En Asana SDK v3.x, next_page está en _response
          offset = projectsResponse._response?.next_page?.offset || null;

        } while (offset);

      } catch (wsError) {
        console.error(`[Asana] Error en workspace ${workspace.gid}:`, wsError.message);
      }

      await sleep(50);
    }

    console.log(`[Asana] No se encontró proyecto con PMO ID: ${pmoIdUpper}`);
    return null;
  } catch (error) {
    console.error('[Asana] Error buscando proyecto por PMO ID:', error);
    throw error;
  }
}

/**
 * Obtiene todos los proyectos no archivados con responsable/estado/PMO ID
 * Usado por cache-refresh para actualizar el cache global
 *
 * @returns {Array<{gid: string, name: string, responsable: string|null, status: string|null, pmoId: string|null}>}
 */
async function getAllActiveProjectsWithResponsable() {
  try {
    initClient();
    console.log('[Asana] Iniciando busqueda paralela de proyectos no archivados...');

    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspacesList = workspacesResponse.data || [];

    const allProjects = [];

    for (const workspace of workspacesList) {
      // Paso 1: Obtener lista de todos los proyectos (solo metadata basica)
      const projectList = [];
      let offset = null;
      let pageCount = 0;

      do {
        const params = { limit: 100, opt_fields: 'name,archived' };
        if (offset) params.offset = offset;

        const response = await getProjectsPageWithRetry(workspace.gid, params, 3);
        const projects = response.data || [];
        pageCount++;

        // Filtrar archivados inmediatamente
        const activeProjects = projects.filter(p => !p.archived);
        projectList.push(...activeProjects);

        console.log(`[Asana] Pagina ${pageCount}: ${projects.length} proyectos (${activeProjects.length} activos)`);

        offset = response._response?.next_page?.offset || null;
        await sleep(50);
      } while (offset);

      console.log(`[Asana] Total proyectos no archivados: ${projectList.length}`);

      // Paso 2: Obtener custom_fields en paralelo (batches moderados para evitar rate limit)
      const BATCH_SIZE = 10;
      let processed = 0;

      for (let i = 0; i < projectList.length; i += BATCH_SIZE) {
        const batch = projectList.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
          batch.map(async (project) => {
            try {
              const detail = await getProjectDetailWithRetry(project.gid, 3);

              const customFields = detail.data?.custom_fields || [];

              const statusField = customFields.find(
                cf => cf.name && cf.name.toLowerCase() === 'status'
              );
              const status = statusField?.display_value || null;

              const responsableField = customFields.find(
                cf => cf.name === 'Responsable Proyecto'
              );
              const responsable = responsableField?.display_value || null;

              const pmoIdField = customFields.find(
                cf => cf.name && cf.name.toLowerCase().includes('pmo id')
              );
              const pmoId = pmoIdField?.display_value || null;

              return {
                gid: project.gid,
                name: project.name,
                responsable,
                status,
                pmoId
              };
            } catch (err) {
              // Ignorar errores individuales (403, etc.)
              return null;
            }
          })
        );

        // Agregar resultados validos
        const validResults = results.filter(r => r !== null);
        allProjects.push(...validResults);

        processed += batch.length;
        console.log(`[Asana] Procesados: ${processed}/${projectList.length} (${validResults.length} con detalle en este batch)`);

        // Pausa entre batches para no saturar Asana
        await sleep(500);
      }
    }

    console.log(`[Asana] Busqueda completada: ${allProjects.length} proyectos no archivados`);
    return allProjects;

  } catch (error) {
    console.error('[Asana] Error en busqueda paralela:', error);
    throw error;
  }
}

async function getProjectDetailWithRetry(projectGid, retries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await projectsApi.getProject(projectGid, {
        opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
      });
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const retryAfter = Number(error?.response?.headers?.['retry-after'] || 0);
      if (status === 429 && attempt < retries) {
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function getProjectsPageWithRetry(workspaceGid, params, retries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await projectsApi.getProjectsForWorkspace(workspaceGid, params);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const retryAfter = Number(error?.response?.headers?.['retry-after'] || 0);
      if (status === 429 && attempt < retries) {
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

function groupProjectsByResponsable(projects) {
  const grouped = new Map();

  for (const project of projects) {
    if (!project.responsable) continue;
    const responsable = project.responsable.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (!grouped.has(responsable)) {
      grouped.set(responsable, []);
    }
    grouped.get(responsable).push({
      gid: project.gid,
      name: project.name
    });
  }

  return grouped;
}

module.exports = {
  getProjectsForUser,
  getProjectDetails,
  getProjectByPmoId,
  getUserByEmail,
  verifyAccess,
  getProjectMilestones,
  getAllActiveProjectsWithResponsable,
  groupProjectsByResponsable
};

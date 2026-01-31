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

module.exports = {
  getProjectsForUser,
  getProjectDetails,
  getProjectByPmoId,
  getUserByEmail,
  verifyAccess,
  getProjectMilestones
};

/**
 * Script para buscar proyectos por Responsable Proyecto
 *
 * Uso:
 *   node test-asana.js "Harold Gomez"      - Busca proyectos del responsable
 *   node test-asana.js --count             - Solo cuenta proyectos totales
 *   node test-asana.js --list-responsables - Lista todos los responsables únicos
 */

require('dotenv').config({ path: '.env.local' });

const Asana = require('asana');

const args = process.argv.slice(2);
const MODE_COUNT = args.includes('--count');
const MODE_LIST = args.includes('--list-responsables');
const SEARCH_NAME = args.find(a => !a.startsWith('--')) || 'Harold Gomez';

function normalizeText(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAsana() {
  const pat = process.env.ASANA_PAT;

  if (!pat) {
    console.error('ASANA_PAT no configurado');
    process.exit(1);
  }

  const client = Asana.ApiClient.instance;
  client.authentications['token'].accessToken = pat;

  const workspacesApi = new Asana.WorkspacesApi();
  const projectsApi = new Asana.ProjectsApi();

  if (MODE_COUNT) {
    console.log('Contando proyectos en todos los workspaces...\n');
  } else if (MODE_LIST) {
    console.log('Listando todos los responsables únicos...\n');
  } else {
    console.log(`Buscando proyectos donde "Responsable Proyecto" = "${SEARCH_NAME}"\n`);
  }

  const normalizedSearch = normalizeText(SEARCH_NAME);
  const matches = [];
  const responsables = new Set();

  try {
    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspaces = workspacesResponse.data || [];

    for (const workspace of workspaces) {
      console.log(`\nWorkspace: "${workspace.name}" (${workspace.gid})`);

      let offset = null;
      let totalReviewed = 0;
      let pageNum = 0;

      do {
        pageNum++;
        const params = { limit: 100, opt_fields: 'name,archived' };
        if (offset) params.offset = offset;

        const projectsResponse = await projectsApi.getProjectsForWorkspace(workspace.gid, params);
        const projects = projectsResponse.data || [];

        console.log(`  Página ${pageNum}: ${projects.length} proyectos`);

        if (MODE_COUNT) {
          // Solo contar, no obtener detalles
          totalReviewed += projects.length;
        } else {
          // Obtener custom_fields de cada proyecto
          for (const project of projects) {
            totalReviewed++;

            // Saltar proyectos archivados
            if (project.archived) continue;

            try {
              const detailResponse = await projectsApi.getProject(project.gid, {
                opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
              });

              const customFields = detailResponse.data?.custom_fields || [];
              const responsableField = customFields.find(cf => cf.name === 'Responsable Proyecto');

              if (responsableField && responsableField.display_value) {
                const responsableValue = responsableField.display_value;

                if (MODE_LIST) {
                  responsables.add(responsableValue);
                } else {
                  const normalizedResponsable = normalizeText(responsableValue);

                  if (normalizedResponsable === normalizedSearch) {
                    console.log(`\n  ✓ MATCH: ${project.name}`);
                    console.log(`    Responsable: "${responsableValue}"`);
                    matches.push({ name: project.name, responsable: responsableValue, gid: project.gid });
                  }
                }
              }

              // Rate limiting - 50ms entre requests
              await sleep(50);

            } catch (err) {
              // Ignorar errores de proyectos individuales
              if (err.status === 403) {
                // Sin acceso, ignorar silenciosamente
              } else {
                console.log(`\n  Error en proyecto ${project.gid}: ${err.message}`);
              }
            }

            // Mostrar progreso cada 50 proyectos
            if (totalReviewed % 50 === 0) {
              process.stdout.write(`  Revisados: ${totalReviewed}...\r`);
            }
          }
        }

        // Verificar si hay más páginas
        offset = projectsResponse._response?.next_page?.offset || null;

        // Rate limiting entre páginas
        await sleep(100);

      } while (offset);

      console.log(`  Total revisados en este workspace: ${totalReviewed}`);
    }

    // Resultados finales
    console.log('\n' + '='.repeat(50));

    if (MODE_COUNT) {
      console.log('Conteo completado.');
    } else if (MODE_LIST) {
      console.log(`\nRESPONSABLES ÚNICOS (${responsables.size}):\n`);
      const sorted = Array.from(responsables).sort();
      for (const r of sorted) {
        console.log(`  • ${r}`);
      }
    } else {
      console.log(`\nRESULTADOS: ${matches.length} proyectos para "${SEARCH_NAME}"\n`);
      for (const m of matches) {
        console.log(`  • ${m.name} (GID: ${m.gid})`);
      }
    }

  } catch (error) {
    console.error('\nError:', error.message);
    if (error.response?.body) {
      console.error('Detalle:', JSON.stringify(error.response.body, null, 2));
    }
  }
}

testAsana();

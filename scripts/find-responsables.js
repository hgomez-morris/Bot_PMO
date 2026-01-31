/**
 * Script rápido para encontrar responsables únicos
 * Muestrea los primeros 200 proyectos no archivados
 */

require('dotenv').config({ path: '.env.local' });
const Asana = require('asana');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    console.error('ASANA_PAT no configurado');
    process.exit(1);
  }

  const client = Asana.ApiClient.instance;
  client.authentications['token'].accessToken = pat;

  const workspacesApi = new Asana.WorkspacesApi();
  const projectsApi = new Asana.ProjectsApi();

  console.log('Buscando responsables en los primeros 200 proyectos no archivados...\n');

  const responsables = new Map(); // nombre -> count
  let checked = 0;
  const MAX_PROJECTS = 200;

  try {
    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspaces = workspacesResponse.data || [];

    for (const workspace of workspaces) {
      console.log(`Workspace: ${workspace.name}\n`);

      let offset = null;

      do {
        if (checked >= MAX_PROJECTS) break;

        const params = { limit: 100, opt_fields: 'name,archived' };
        if (offset) params.offset = offset;

        const projectsResponse = await projectsApi.getProjectsForWorkspace(workspace.gid, params);
        const projects = projectsResponse.data || [];

        for (const project of projects) {
          if (checked >= MAX_PROJECTS) break;
          if (project.archived) continue;

          try {
            const detail = await projectsApi.getProject(project.gid, {
              opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
            });

            const customFields = detail.data?.custom_fields || [];
            const responsableField = customFields.find(cf => cf.name === 'Responsable Proyecto');

            if (responsableField?.display_value) {
              const name = responsableField.display_value;
              responsables.set(name, (responsables.get(name) || 0) + 1);
            }

            checked++;
            process.stdout.write(`\rRevisados: ${checked}/${MAX_PROJECTS}`);
            await sleep(30);

          } catch (err) {
            if (err.status !== 403) {
              console.log(`\nError: ${err.message}`);
            }
          }
        }

        offset = projectsResponse._response?.next_page?.offset || null;
        await sleep(50);

      } while (offset && checked < MAX_PROJECTS);
    }

    console.log('\n\n' + '='.repeat(50));
    console.log(`\nRESPONSABLES ENCONTRADOS (en ${checked} proyectos):\n`);

    const sorted = [...responsables.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      console.log(`  ${count.toString().padStart(3)} proyectos: ${name}`);
    }

    // Buscar coincidencias parciales con "harold"
    console.log('\n--- Buscando "harold" (parcial) ---\n');
    const haroldMatches = sorted.filter(([name]) =>
      name.toLowerCase().includes('harold')
    );
    if (haroldMatches.length > 0) {
      for (const [name, count] of haroldMatches) {
        console.log(`  ENCONTRADO: "${name}" (${count} proyectos)`);
      }
    } else {
      console.log('  No se encontró "harold" en los responsables muestreados.');
    }

  } catch (error) {
    console.error('\nError:', error.message);
  }
}

main();

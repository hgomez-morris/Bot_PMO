/**
 * Busca TODOS los proyectos que contengan "harold" en Responsable Proyecto
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

  console.log('Buscando TODOS los proyectos con "harold" como responsable...\n');
  console.log('(Esto puede tomar varios minutos para 1382 proyectos)\n');

  const matches = [];
  let checked = 0;
  let startTime = Date.now();

  try {
    const workspacesResponse = await workspacesApi.getWorkspaces({});
    const workspaces = workspacesResponse.data || [];

    for (const workspace of workspaces) {
      console.log(`Workspace: ${workspace.name}\n`);

      let offset = null;
      let pageNum = 0;

      do {
        pageNum++;
        const params = { limit: 100, opt_fields: 'name,archived' };
        if (offset) params.offset = offset;

        const projectsResponse = await projectsApi.getProjectsForWorkspace(workspace.gid, params);
        const projects = projectsResponse.data || [];

        for (const project of projects) {
          if (project.archived) continue;

          try {
            const detail = await projectsApi.getProject(project.gid, {
              opt_fields: 'custom_fields,custom_fields.name,custom_fields.display_value'
            });

            const customFields = detail.data?.custom_fields || [];
            const responsableField = customFields.find(cf => cf.name === 'Responsable Proyecto');

            if (responsableField?.display_value) {
              const name = responsableField.display_value.toLowerCase();
              if (name.includes('harold')) {
                console.log(`\n  *** ENCONTRADO: "${project.name}"`);
                console.log(`      Responsable: "${responsableField.display_value}"`);
                console.log(`      GID: ${project.gid}`);
                matches.push({
                  projectName: project.name,
                  responsable: responsableField.display_value,
                  gid: project.gid
                });
              }
            }

            checked++;
            if (checked % 100 === 0) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              const rate = Math.round(checked / elapsed * 60);
              console.log(`  [${elapsed}s] Revisados: ${checked} proyectos (${rate}/min)`);
            }

            await sleep(25);

          } catch (err) {
            if (err.status !== 403) {
              // console.log(`\nError: ${err.message}`);
            }
          }
        }

        offset = projectsResponse._response?.next_page?.offset || null;
        await sleep(50);

      } while (offset);
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log('\n' + '='.repeat(50));
    console.log(`\nBúsqueda completada en ${totalTime} segundos`);
    console.log(`Proyectos revisados: ${checked}`);
    console.log(`\nProyectos con "harold" como responsable: ${matches.length}\n`);

    if (matches.length > 0) {
      for (const m of matches) {
        console.log(`  • ${m.projectName}`);
        console.log(`    Responsable: ${m.responsable}`);
        console.log(`    GID: ${m.gid}\n`);
      }
    } else {
      console.log('  No se encontraron proyectos con "harold" como responsable.');
      console.log('  Verifica que el nombre esté escrito correctamente en Asana.');
    }

  } catch (error) {
    console.error('\nError:', error.message);
  }
}

main();

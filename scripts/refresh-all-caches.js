/**
 * Script para refrescar el cache global de proyectos
 *
 * Uso: node scripts/refresh-all-caches.js
 *
 * Este script ejecuta la misma logica que la Lambda cache-refresh
 * pero localmente para refresh manual.
 */

require('dotenv').config({ path: '.env.local' });

const asanaService = require('../src/services/asana');
const dynamoService = require('../src/services/dynamo');

async function main() {
  console.log('='.repeat(50));
  console.log('REFRESH CACHE GLOBAL DE PROYECTOS');
  console.log('='.repeat(50) + '
');

  const startTime = Date.now();

  try {
    const allProjects = await asanaService.getAllActiveProjectsWithResponsable();
    console.log(`Proyectos no archivados: ${allProjects.length}`);

    let updated = 0;
    let deleted = 0;
    let skipped = 0;

    for (const project of allProjects) {
      const status = (project.status || '').toLowerCase();
      if (status === 'completed') {
        await dynamoService.deleteProjectCache(project.gid);
        deleted++;
        continue;
      }

      if (!project.pmoId && !project.responsable) {
        skipped++;
        continue;
      }

      await dynamoService.upsertProjectCache(project);
      updated++;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('
' + '='.repeat(50));
    console.log(`COMPLETADO en ${elapsed} segundos`);
    console.log(`  Proyectos procesados: ${allProjects.length}`);
    console.log(`  Actualizados: ${updated}`);
    console.log(`  Eliminados: ${deleted}`);
    console.log(`  Omitidos: ${skipped}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('
Error:', error.message);
    process.exit(1);
  }
}

main();

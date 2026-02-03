/**
 * Cache Refresh Handler
 *
 * Lambda que refresca el cache global de proyectos (no archivados).
 * Se ejecuta automaticamente cada 6 horas via EventBridge.
 *
 * Optimizaciones:
 * - Solo proyectos con Status != "completed"
 * - Requests paralelas a Asana (20 simultaneas)
 */

const asanaService = require('../services/asana');
const dynamoService = require('../services/dynamo');

/**
 * Handler principal
 */
exports.handler = async (event) => {
  console.log('[CacheRefresh] Iniciando refresh de cache global...');
  const startTime = Date.now();

  try {
    // 1. Obtener todos los proyectos no archivados con detalle
    const allProjects = await asanaService.getAllActiveProjectsWithResponsable();
    console.log(`[CacheRefresh] Proyectos no archivados encontrados: ${allProjects.length}`);

    // 2. Actualizar cache global
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
    const summary = {
      elapsed: `${elapsed}s`,
      totalProjects: allProjects.length,
      updated,
      deleted,
      skipped
    };

    console.log('[CacheRefresh] Completado:', JSON.stringify(summary));

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };
  } catch (error) {
    console.error('[CacheRefresh] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Scheduled Pulse Handler
 *
 * Disparado por EventBridge los Lunes y Jueves.
 * Envía solicitudes de update a todos los PMs onboarded.
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 2.2
 */

const { DateTime } = require('luxon');
const dynamoService = require('../services/dynamo');
const slackService = require('../services/slack');
const asanaService = require('../services/asana');
const messages = require('../lib/messages');

/**
 * Handler principal de Lambda
 */
exports.handler = async (event) => {
  console.log('Scheduled Pulse iniciado:', new Date().toISOString());
  console.log('Evento:', JSON.stringify(event, null, 2));

  const stats = {
    usersProcessed: 0,
    projectsFound: 0,
    requestsSent: 0,
    errors: []
  };

  try {
    // 1. Obtener todos los usuarios onboarded
    const users = await dynamoService.getAllOnboardedUsers();
    console.log(`Usuarios onboarded encontrados: ${users.length}`);

    // 2. Obtener proyectos que ya tienen update hoy
    const updatedToday = await dynamoService.getProjectsUpdatedToday();
    const updatedTodaySet = new Set(updatedToday);

    // 3. Procesar cada usuario
    for (const user of users) {
      try {
        stats.usersProcessed++;

        // Verificar si es hora apropiada en timezone del usuario
        if (!isAppropriateTime(user.timezone)) {
          console.log(`Saltando usuario ${user.slackUserId} - fuera de horario (${user.timezone})`);
          continue;
        }

        // Obtener proyectos del usuario desde Asana
        const projects = await asanaService.getProjectsForUser(user.asanaEmail);

        // Limitar a 5 proyectos en MVP
        const projectsToProcess = projects.slice(0, 5);
        stats.projectsFound += projectsToProcess.length;

        // Enviar solicitud para cada proyecto que no tenga update hoy
        for (const project of projectsToProcess) {
          if (updatedTodaySet.has(project.gid)) {
            console.log(`Proyecto ${project.gid} ya tiene update hoy, saltando`);
            continue;
          }

          await slackService.sendUpdateRequest(
            user.slackUserId,
            project.name,
            project.gid
          );
          stats.requestsSent++;

          // Rate limiting: esperar 1 segundo entre mensajes
          await sleep(1000);
        }

      } catch (userError) {
        console.error(`Error procesando usuario ${user.slackUserId}:`, userError);
        stats.errors.push({
          userId: user.slackUserId,
          error: userError.message
        });
      }
    }

    console.log('Scheduled Pulse completado:', stats);
    return {
      statusCode: 200,
      body: JSON.stringify(stats)
    };

  } catch (error) {
    console.error('Error en Scheduled Pulse:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Verifica si es hora apropiada para enviar solicitudes (8-10 AM local)
 */
function isAppropriateTime(timezone) {
  try {
    const now = DateTime.now().setZone(timezone);
    const hour = now.hour;
    return hour >= 8 && hour <= 10;
  } catch (error) {
    console.error(`Error con timezone ${timezone}:`, error);
    // En caso de error, asumir que sí es apropiado
    return true;
  }
}

/**
 * Función auxiliar para esperar
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

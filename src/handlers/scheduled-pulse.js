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
const conversationState = require('../lib/conversation-state');

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

        if (!user.asanaName) {
          console.log(`Usuario ${user.slackUserId} sin asanaName, saltando`);
          continue;
        }

        // Si ya hay una conversacion activa, no iniciar otra cola
        const state = await conversationState.getConversationState(user.slackUserId);
        if (state && conversationState.isInUpdateFlow(state)) {
          console.log(`Usuario ${user.slackUserId} ya tiene flujo activo, saltando`);
          continue;
        }

        // Obtener proyectos del usuario desde cache global
        const projects = await dynamoService.getProjectsByResponsableName(user.asanaName);

        // Filtrar completados y los que ya tienen update hoy
        const filtered = projects.filter((project) => {
          const status = (project.status || '').toLowerCase();
          if (status === 'completed') return false;
          if (updatedTodaySet.has(project.gid)) return false;
          return true;
        });

        // Ordenar por PMO-ID numerico si existe
        filtered.sort((a, b) => {
          const aNum = parsePmoIdNumber(a.pmoId);
          const bNum = parsePmoIdNumber(b.pmoId);
          return aNum - bNum;
        });

        if (filtered.length === 0) {
          continue;
        }

        stats.projectsFound += filtered.length;

        // Iniciar flujo secuencial con el primer proyecto
        const firstProject = filtered[0];
        await conversationState.setConversationState(user.slackUserId, {
          step: 'awaiting_status',
          pendingProjects: filtered.map((p) => ({
            gid: p.gid,
            name: p.name,
            pmoId: p.pmoId || null,
            status: p.status || null
          })),
          currentIndex: 0,
          currentProjectGid: firstProject.gid,
          currentProjectName: firstProject.name,
          currentProjectPmoId: firstProject.pmoId || null,
          lastPromptAt: new Date().toISOString()
        });

        await slackService.sendUpdateRequest(
          user.slackUserId,
          firstProject.name,
          firstProject.gid
        );
        stats.requestsSent++;

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

function parsePmoIdNumber(pmoId) {
  if (!pmoId) return Number.POSITIVE_INFINITY;
  const match = String(pmoId).match(/\d+/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[0]);
}

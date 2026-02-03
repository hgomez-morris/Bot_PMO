/**
 * Slack Events Handler
 *
 * Maneja todos los eventos entrantes de Slack:
 * - url_verification: Verificación inicial del endpoint
 * - event_callback (message): Mensajes DM al bot
 * - block_actions: Interacciones con botones
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 2.1
 */

const slackService = require('../services/slack');
const dynamoService = require('../services/dynamo');
const agentService = require('../services/agent');
const messages = require('../lib/messages');
const riskDetector = require('../lib/risk-detector');
const conversationState = require('../lib/conversation-state');

/**
 * Handler principal de Lambda
 */
exports.handler = async (event) => {
  console.log('Evento recibido:', JSON.stringify(event, null, 2));

  try {
    // 1. Decodificar body si viene en base64
    let rawBody = event.body;
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
    }

    // Slack reintenta si no respondemos rapido. Evitar duplicados.
    const retryNum = event.headers?.['x-slack-retry-num'] || event.headers?.['X-Slack-Retry-Num'];
    const retryReason = event.headers?.['x-slack-retry-reason'] || event.headers?.['X-Slack-Retry-Reason'];
    if (retryNum || retryReason) {
      console.warn(`Slack retry recibido (num=${retryNum || 'n/a'} reason=${retryReason || 'n/a'}). Ignorando.`);
      return { statusCode: 200, body: 'OK' };
    }

    // 2. Parsear body según content-type
    let body;
    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // block_actions viene como form-urlencoded con campo "payload"
      const params = new URLSearchParams(rawBody);
      const payloadStr = params.get('payload');
      if (payloadStr) {
        body = JSON.parse(payloadStr);
      } else {
        body = {};
      }
    } else {
      // event_callback y url_verification vienen como JSON
      body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    }

    // 3. Verificar firma de Slack (excepto para url_verification)
    if (body.type !== 'url_verification') {
      const isValid = slackService.verifySlackSignature(event.headers, rawBody);
      if (!isValid) {
        console.error('Firma de Slack inválida');
        return { statusCode: 401, body: 'Invalid signature' };
      }
    }

    // 4. Manejar url_verification
    if (body.type === 'url_verification') {
      console.log('URL verification challenge');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: body.challenge })
      };
    }

    // 5. Manejar event_callback (mensajes)
    if (body.type === 'event_callback') {
      await handleEventCallback(body.event);
    }

    // 6. Manejar block_actions (botones)
    if (body.type === 'block_actions') {
      await handleBlockActions(body);
    }

    // Responder 200 OK rápidamente
    return { statusCode: 200, body: 'OK' };

  } catch (error) {
    console.error('Error en handler:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

/**
 * Maneja eventos de tipo message
 */
async function handleEventCallback(event) {
  // Solo procesar mensajes DM (channel empieza con 'D')
  if (event.type !== 'message' || !event.channel?.startsWith('D')) {
    return;
  }

  // Ignorar mensajes del propio bot
  if (event.bot_id || event.subtype === 'bot_message') {
    return;
  }

  const userId = event.user;
  const text = event.text || '';

  console.log(`Mensaje de usuario ${userId}: ${text}`);

  // Verificar si usuario existe
  const user = await dynamoService.getUser(userId);

  if (!user || !user.onboarded) {
    // Iniciar o continuar onboarding
    await handleOnboarding(userId, text, user);
  } else {
    // Usuario onboarded - procesar como texto de avances
    await handleAdvancesText(userId, text);
  }
}

/**
 * Maneja el flujo de onboarding
 */
async function handleOnboarding(userId, text, existingUser) {
  if (!existingUser) {
    // Primer mensaje - pedir nombre
    await slackService.sendMessage(userId, null, messages.getOnboardingNameBlocks());
    await dynamoService.saveUser({
      slackUserId: userId,
      onboarded: false
    });
  } else if (!existingUser.asanaName) {
    // Guardar nombre
    const name = text.trim();
    if (name.length >= 2) {
      await dynamoService.updateUser(userId, { asanaName: name });
      await slackService.sendMessage(userId, null, messages.getOnboardingTimezoneBlocks());
    } else {
      await slackService.sendMessage(userId, 'Por favor ingresa tu nombre completo.');
    }
  } else if (!existingUser.timezone) {
    // Si tiene nombre pero no timezone, pedir timezone
    await slackService.sendMessage(userId, null, messages.getOnboardingTimezoneBlocks());
  }
}

/**
 * Maneja texto libre (avances del proyecto o comandos)
 */
async function handleAdvancesText(userId, text) {
  const textLower = text.trim().toLowerCase();

  // Comandos especiales
  if (textLower === 'ayuda' || textLower === 'help') {
    await slackService.sendMessage(userId, null, messages.getHelpBlocks());
    return;
  }

  if (textLower === 'reset' || textLower === 'reiniciar') {
    await dynamoService.deleteUser(userId);
    await slackService.sendMessage(userId, 'Perfil reiniciado. Escribe cualquier cosa para comenzar de nuevo.');
    return;
  }

  if (textLower === 'mis proyectos' || textLower === 'proyectos') {
    const user = await dynamoService.getUser(userId);
    if (user?.asanaName) {
      const projects = await dynamoService.getProjectsByResponsableName(user.asanaName);
      if (projects.length > 0) {
        const projectList = projects.map(p => `- ${p.name}`).join('\n');
        await slackService.sendMessage(
          userId,
          `*Tus proyectos (${projects.length}):*
${projectList}`
        );
      } else {
        await slackService.sendMessage(
          userId,
          `Aun no tengo proyectos cacheados para tu perfil.
` +
          `Tu nombre en Asana: *${user.asanaName}*.
` +
          `El cache global se actualiza cada 6 horas.`
        );
      }
    } else {
      await slackService.sendMessage(userId, 'No tienes configurado tu nombre. Escribe "reset" para reconfigurar tu perfil.');
    }
    return;
  }


  // Buscar proyecto por PMO ID (ej: PMO-911)
  const pmoIdMatch = text.match(/pmo-?\d+/i);
  if (pmoIdMatch) {
    const rawPmoId = pmoIdMatch[0];
    const pmoId = rawPmoId.toUpperCase().replace('PMO', 'PMO-').replace('PMO--', 'PMO-');
    await slackService.sendMessage(userId, `Buscando proyecto ${pmoId}...`);

    try {
      const project = await dynamoService.getProjectByPmoIdCached(pmoId);
      if (project) {
        const info = [
          `*${project.name}*`,
          `- PMO ID: ${project.pmoId || pmoId}`,
          `- Responsable: ${project.responsable || 'No asignado'}`,
          `- Estado: ${project.status || 'Sin estado'}`
        ].join('\n');
        await slackService.sendMessage(userId, info);
      } else {
        await slackService.sendMessage(userId, `No encontre ningun proyecto con ID ${pmoId}`);
      }
    } catch (error) {
      console.error(`Error buscando proyecto ${pmoId}:`, error);
      await slackService.sendMessage(
        userId,
        `Hubo un problema buscando el proyecto ${pmoId}. Intenta de nuevo en unos minutos.`
      );
    }
    return;
  }

  // Obtener estado de conversación
  const state = await conversationState.getConversationState(userId);

  if (state && state.step === 'awaiting_advances') {
    // Guardar update completo
    await dynamoService.saveUpdate({
      projectGid: state.projectGid,
      projectName: state.projectName,
      pmSlackId: userId,
      status: state.status,
      advances: text,
      hasBlockers: state.hasBlockers,
      blockerDescription: state.blockerDescription || null
    });

    // Evaluar riesgo
    const previousUpdates = await dynamoService.getLastUpdates(state.projectGid, 2);
    const riskAnalysis = riskDetector.shouldAlert(
      { status: state.status, hasBlockers: state.hasBlockers },
      previousUpdates
    );

    if (riskAnalysis.shouldAlert) {
      await slackService.sendAlertToPMO(
        state.projectName,
        userId,
        state.status,
        text,
        state.hasBlockers
      );
    }

    // Limpiar estado y confirmar
    await conversationState.clearConversationState(userId);
    await slackService.sendMessage(userId, `${messages.getStatusEmoji(state.status)} Update registrado para *${state.projectName}*. ¡Gracias!`);
    return;
  }

  // Si no se reconoció ningún comando, usar el agente
  await handleWithAgent(userId, text);
}

/**
 * Procesa mensaje con el agente de IA
 */
async function handleWithAgent(userId, text) {
  try {
    const user = await dynamoService.getUser(userId);
    const result = await agentService.processMessage(text, { email: user?.asanaEmail });

    // Si el agente devuelve una respuesta directa
    if (result.response) {
      await slackService.sendMessage(userId, result.response);
      return;
    }

    // Si el agente quiere ejecutar una herramienta
    if (result.tool) {
      switch (result.tool) {
        case 'buscar_proyecto':
          const pmoId = result.params.pmo_id;
          const project = await dynamoService.getProjectByPmoIdCached(pmoId);
          if (project) {
            const info = [
              `*${project.name}*`,
              `- PMO ID: ${project.pmoId || pmoId}`,
              `- Responsable: ${project.responsable || 'No asignado'}`,
              `- Estado: ${project.status || 'Sin estado'}`
            ].join('\n');
            await slackService.sendMessage(userId, info);
          } else {
            await slackService.sendMessage(userId, `No encontre ningun proyecto con ID ${pmoId}`);
          }
          break;

        case 'mis_proyectos':
          if (user?.asanaName) {
            const projects = await dynamoService.getProjectsByResponsableName(user.asanaName);
            if (projects.length > 0) {
              const projectList = projects.map(p => `- ${p.name}`).join('\n');
              await slackService.sendMessage(userId, `*Tus proyectos:*
${projectList}`);
            } else {
              await slackService.sendMessage(
                userId,
                'Aun no tengo proyectos cacheados para tu perfil. El cache global se actualiza cada 6 horas.'
              );
            }
          } else {
            await slackService.sendMessage(userId, 'No tienes configurado tu nombre. Escribe "reset" para reconfigurar tu perfil.');
          }
          break;

        case 'mostrar_ayuda':
          await slackService.sendMessage(userId, null, messages.getHelpBlocks());
          break;

        case 'respuesta_directa':
          await slackService.sendMessage(userId, result.params.mensaje);
          break;

        default:
          await slackService.sendMessage(userId, 'No entendí tu mensaje. Escribe "ayuda" para ver qué puedo hacer.');
      }
    }
  } catch (error) {
    console.error('Error en agente:', error);
    await slackService.sendMessage(userId, 'Hubo un error procesando tu mensaje. Intenta de nuevo.');
  }
}

/**
 * Maneja interacciones con botones
 */
async function handleBlockActions(payload) {
  const userId = payload.user.id;
  const action = payload.actions[0];
  const actionId = action.action_id;
  const value = action.value || action.selected_option?.value;

  console.log(`Acción de ${userId}: ${actionId} = ${value}`);

  // Parsear action_id: tipo_projectGid_valor
  const parts = actionId.split('_');
  const actionType = parts[0];

  if (actionType === 'status') {
    // status_{projectGid}_{value}
    const projectGid = parts[1];
    await conversationState.setConversationState(userId, {
      step: 'awaiting_blockers',
      projectGid,
      status: value
    });
    // El mensaje de bloqueos ya está en el mensaje original
  } else if (actionType === 'blockers') {
    // blockers_{projectGid}_{yes|no}
    const state = await conversationState.getConversationState(userId);
    const hasBlockers = value === 'yes';

    await conversationState.setConversationState(userId, {
      ...state,
      step: 'awaiting_advances',
      hasBlockers
    });

    // Pedir descripción de avances
    await slackService.sendMessage(userId, 'Por favor describe brevemente los *avances* desde tu último update:');
  } else if (actionType === 'timezone') {
    // timezone_{value}
    await dynamoService.updateUser(userId, {
      timezone: value,
      onboarded: true
    });
    await slackService.sendMessage(userId, null, messages.getOnboardingCompleteBlocks(value));
  }
}

/**
 * Slack Service
 *
 * Maneja todas las interacciones con la API de Slack.
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 1.4
 */

const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');
const messages = require('../lib/messages');

// Cliente de Slack
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Canal PMO para alertas
const PMO_CHANNEL_ID = process.env.SLACK_CHANNEL_PMO;

/**
 * Verifica la firma de Slack para validar que el request es auténtico
 * @param {Object} headers - Headers del request
 * @param {string} body - Body raw del request
 * @returns {boolean}
 */
function verifySlackSignature(headers, body) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET no configurado');
    return false;
  }

  const timestamp = headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];
  const slackSignature = headers['x-slack-signature'] || headers['X-Slack-Signature'];

  if (!timestamp || !slackSignature) {
    console.error('Headers de firma de Slack faltantes');
    return false;
  }

  // Verificar que el timestamp no es muy viejo (5 minutos)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    console.error('Timestamp de Slack muy antiguo');
    return false;
  }

  // Calcular firma esperada
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  // Comparar firmas de forma segura
  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(slackSignature)
  );
}

/**
 * Envía solicitud de update a un PM
 * @param {string} slackUserId - ID de usuario de Slack
 * @param {string} projectName - Nombre del proyecto
 * @param {string} projectGid - GID del proyecto en Asana
 */
async function sendUpdateRequest(slackUserId, projectName, projectGid) {
  const blocks = messages.getUpdateRequestBlocks(projectName, projectGid);

  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: `Es momento del update para ${projectName}`,
      blocks
    });
    console.log(`Solicitud de update enviada a ${slackUserId} para proyecto ${projectGid}`);
  } catch (error) {
    console.error(`Error enviando solicitud de update a ${slackUserId}:`, error);
    throw error;
  }
}

/**
 * Envía pregunta de onboarding
 * @param {string} slackUserId
 * @param {string} question
 * @param {Array|null} options - Si es array, incluye botones
 */
async function sendOnboardingQuestion(slackUserId, question, options = null) {
  let blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: question }
    }
  ];

  if (options && Array.isArray(options)) {
    blocks.push({
      type: 'actions',
      elements: options.map(opt => ({
        type: 'button',
        text: { type: 'plain_text', text: opt.label },
        value: opt.value,
        action_id: `onboarding_${opt.value}`
      }))
    });
  }

  try {
    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: question,
      blocks
    });
  } catch (error) {
    console.error(`Error enviando pregunta de onboarding a ${slackUserId}:`, error);
    throw error;
  }
}

/**
 * Envía alerta al canal PMO
 * @param {string} projectName
 * @param {string} pmSlackId
 * @param {string} status
 * @param {string} advances
 * @param {boolean} hasBlockers
 */
async function sendAlertToPMO(projectName, pmSlackId, status, advances, hasBlockers) {
  if (!PMO_CHANNEL_ID) {
    console.error('SLACK_CHANNEL_PMO no configurado');
    return;
  }

  const blocks = messages.getAlertBlocks(projectName, pmSlackId, status, advances, hasBlockers);

  try {
    await slackClient.chat.postMessage({
      channel: PMO_CHANNEL_ID,
      text: `Alerta: ${projectName}`,
      blocks
    });
    console.log(`Alerta enviada a PMO para proyecto ${projectName}`);
  } catch (error) {
    console.error('Error enviando alerta a PMO:', error);
    throw error;
  }
}

/**
 * Envía mensaje genérico
 * @param {string} channel - User ID (para DM) o Channel ID
 * @param {string} text - Texto del mensaje
 * @param {Array|null} blocks - Bloques opcionales
 */
async function sendMessage(channel, text, blocks = null) {
  const messagePayload = {
    channel,
    text: text || 'Mensaje del bot'
  };

  if (blocks) {
    messagePayload.blocks = blocks;
  }

  try {
    await slackClient.chat.postMessage(messagePayload);
  } catch (error) {
    console.error(`Error enviando mensaje a ${channel}:`, error);
    throw error;
  }
}

/**
 * Obtiene información de un usuario de Slack
 * @param {string} userId
 * @returns {Object}
 */
async function getUserInfo(userId) {
  try {
    const response = await slackClient.users.info({ user: userId });
    return response.user;
  } catch (error) {
    console.error(`Error obteniendo info de usuario ${userId}:`, error);
    throw error;
  }
}

/**
 * Verifica que el token de Slack es válido
 * @returns {boolean}
 */
async function verifyToken() {
  try {
    const response = await slackClient.auth.test();
    console.log('Slack auth test:', response);
    return response.ok;
  } catch (error) {
    console.error('Error verificando token de Slack:', error);
    return false;
  }
}

module.exports = {
  verifySlackSignature,
  sendUpdateRequest,
  sendOnboardingQuestion,
  sendAlertToPMO,
  sendMessage,
  getUserInfo,
  verifyToken
};

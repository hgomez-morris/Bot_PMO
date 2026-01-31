/**
 * send-feedback-request.js - Envía solicitud de feedback a los PMs
 *
 * Uso: node scripts/send-feedback-request.js
 */

require('dotenv').config({ path: '.env.local' });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { WebClient } = require('@slack/web-api');

// Configuración
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const USERS_TABLE = process.env.USERS_TABLE || 'pmo-bot-users-dev';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'pmo-bot-feedback-dev';

// Colores
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(type, msg) {
  const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
  const colors = { info: c.cyan, success: c.green, warn: c.yellow, error: c.red };
  console.log(`${colors[type] || ''}${icons[type] || ''} ${msg}${c.reset}`);
}

function getFeedbackBlocks(weeksActive) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📝 Tu Feedback es Importante',
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `¡Hola! Llevamos *${weeksActive} semana(s)* usando Project Pulse Bot.\n\nNos encantaría conocer tu experiencia para seguir mejorando.`
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿Qué tan fácil es responder los updates?*'
      }
    },
    {
      type: 'actions',
      block_id: 'feedback_ease',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '😊 Muy fácil', emoji: true },
          value: 'very_easy',
          action_id: 'feedback_ease_very_easy'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🙂 Fácil', emoji: true },
          value: 'easy',
          action_id: 'feedback_ease_easy'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '😐 Normal', emoji: true },
          value: 'normal',
          action_id: 'feedback_ease_normal'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '😕 Difícil', emoji: true },
          value: 'difficult',
          action_id: 'feedback_ease_difficult'
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿La información solicitada es clara?*'
      }
    },
    {
      type: 'actions',
      block_id: 'feedback_clarity',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '👍 Sí, muy clara', emoji: true },
          value: 'very_clear',
          action_id: 'feedback_clarity_very_clear'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🤔 Más o menos', emoji: true },
          value: 'somewhat_clear',
          action_id: 'feedback_clarity_somewhat'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '👎 No, confusa', emoji: true },
          value: 'not_clear',
          action_id: 'feedback_clarity_not_clear'
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿El bot te ahorra tiempo en el reporting?*'
      }
    },
    {
      type: 'actions',
      block_id: 'feedback_time',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '⏱️ Sí, mucho', emoji: true },
          value: 'saves_lot',
          action_id: 'feedback_time_saves_lot'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '⏳ Un poco', emoji: true },
          value: 'saves_some',
          action_id: 'feedback_time_saves_some'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🤷 No realmente', emoji: true },
          value: 'no_save',
          action_id: 'feedback_time_no_save'
        }
      ]
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '💡 *¿Tienes sugerencias de mejora?*\n_Responde a este mensaje con tus comentarios._'
      }
    }
  ];
}

async function getOnboardedUsers() {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: 'onboarded = :onboarded',
      ExpressionAttributeValues: { ':onboarded': true }
    }));
    return response.Items || [];
  } catch (error) {
    log('error', `Error obteniendo usuarios: ${error.message}`);
    return [];
  }
}

async function sendFeedbackRequest(user, weeksActive) {
  try {
    const blocks = getFeedbackBlocks(weeksActive);

    await slackClient.chat.postMessage({
      channel: user.slackUserId,
      text: '📝 Tu Feedback es Importante - Project Pulse Bot',
      blocks
    });

    log('success', `Feedback enviado a ${user.slackUserId} (${user.asanaEmail})`);
    return true;
  } catch (error) {
    log('error', `Error enviando a ${user.slackUserId}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.cyan}  ENVÍO DE SOLICITUD DE FEEDBACK - PROJECT PULSE BOT${c.reset}`);
  console.log(`${c.cyan}═══════════════════════════════════════════════════════════${c.reset}\n`);

  // Verificar token de Slack
  if (!process.env.SLACK_BOT_TOKEN) {
    log('error', 'SLACK_BOT_TOKEN no configurado. Crear archivo .env.local');
    process.exit(1);
  }

  // Calcular semanas activas (desde inicio del piloto)
  const pilotStartDate = process.env.PILOT_START_DATE || '2026-01-27';
  const weeksActive = Math.max(1, Math.floor(
    (new Date() - new Date(pilotStartDate)) / (7 * 24 * 60 * 60 * 1000)
  ));

  log('info', `Semanas de piloto: ${weeksActive}`);

  // Obtener usuarios
  log('info', 'Obteniendo usuarios onboarded...');
  const users = await getOnboardedUsers();

  if (users.length === 0) {
    log('warn', 'No hay usuarios onboarded');
    process.exit(0);
  }

  log('info', `Usuarios encontrados: ${users.length}`);

  // Confirmar antes de enviar
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(`\n¿Enviar feedback request a ${users.length} usuario(s)? (s/n): `, async (answer) => {
    rl.close();

    if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'si') {
      log('info', 'Operación cancelada');
      process.exit(0);
    }

    console.log('');

    // Enviar a cada usuario
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      const success = await sendFeedbackRequest(user, weeksActive);
      if (success) sent++;
      else failed++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Resumen
    console.log(`\n${c.cyan}─────────────────────────────────────────${c.reset}`);
    log('info', `Resumen: ${sent} enviados, ${failed} fallidos`);

    if (sent === users.length) {
      log('success', '¡Todos los feedback requests enviados correctamente!');
    }

    process.exit(0);
  });
}

main().catch(error => {
  log('error', `Error fatal: ${error.message}`);
  process.exit(1);
});

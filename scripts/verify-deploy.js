/**
 * verify-deploy.js - Verifica que el despliegue está funcionando correctamente
 *
 * Uso: node scripts/verify-deploy.js
 */

require('dotenv').config({ path: '.env.local' });

const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { WebClient } = require('@slack/web-api');

// Colores para output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.cyan}${'='.repeat(50)}\n${msg}\n${'='.repeat(50)}${colors.reset}`)
};

async function verifyDynamoDB() {
  log.header('Verificando DynamoDB');

  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const tables = [
    process.env.USERS_TABLE || 'pmo-bot-users-dev',
    process.env.UPDATES_TABLE || 'pmo-bot-updates-dev',
    process.env.CONVERSATIONS_TABLE || 'pmo-bot-conversations-dev'
  ];

  let allOk = true;

  for (const tableName of tables) {
    try {
      const command = new DescribeTableCommand({ TableName: tableName });
      const response = await client.send(command);
      const status = response.Table.TableStatus;

      if (status === 'ACTIVE') {
        log.success(`Tabla ${tableName}: ${status}`);
      } else {
        log.warn(`Tabla ${tableName}: ${status}`);
        allOk = false;
      }
    } catch (error) {
      log.error(`Tabla ${tableName}: ${error.message}`);
      allOk = false;
    }
  }

  return allOk;
}

async function verifySlack() {
  log.header('Verificando Slack');

  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    log.error('SLACK_BOT_TOKEN no configurado');
    return false;
  }

  const client = new WebClient(token);

  try {
    const response = await client.auth.test();
    log.success(`Slack conectado como: ${response.user} (${response.team})`);

    // Verificar que podemos enviar al canal PMO
    const channel = process.env.SLACK_CHANNEL_PMO;
    if (channel) {
      try {
        // Solo verificar info del canal, no enviar mensaje
        const channelInfo = await client.conversations.info({ channel });
        log.success(`Canal PMO accesible: #${channelInfo.channel.name}`);
      } catch (channelError) {
        log.warn(`Canal PMO (${channel}): ${channelError.message}`);
        log.info('El bot puede no estar invitado al canal');
      }
    } else {
      log.warn('SLACK_CHANNEL_PMO no configurado');
    }

    return true;
  } catch (error) {
    log.error(`Slack: ${error.message}`);
    return false;
  }
}

async function verifyAsana() {
  log.header('Verificando Asana');

  const pat = process.env.ASANA_PAT;

  if (!pat) {
    log.error('ASANA_PAT no configurado');
    return false;
  }

  try {
    // Usar fetch nativo para verificar Asana
    const response = await fetch('https://app.asana.com/api/1.0/users/me', {
      headers: {
        'Authorization': `Bearer ${pat}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      log.success(`Asana conectado como: ${data.data.name} (${data.data.email})`);
      return true;
    } else {
      log.error(`Asana: HTTP ${response.status}`);
      return false;
    }
  } catch (error) {
    log.error(`Asana: ${error.message}`);
    return false;
  }
}

async function verifyEnvironment() {
  log.header('Verificando Variables de Entorno');

  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_CHANNEL_PMO',
    'ASANA_PAT'
  ];

  const optional = [
    'AWS_REGION',
    'USERS_TABLE',
    'UPDATES_TABLE',
    'CONVERSATIONS_TABLE'
  ];

  let allOk = true;

  for (const varName of required) {
    if (process.env[varName]) {
      const masked = process.env[varName].substring(0, 10) + '...';
      log.success(`${varName}: ${masked}`);
    } else {
      log.error(`${varName}: NO CONFIGURADO`);
      allOk = false;
    }
  }

  for (const varName of optional) {
    if (process.env[varName]) {
      log.success(`${varName}: ${process.env[varName]}`);
    } else {
      log.info(`${varName}: usando valor por defecto`);
    }
  }

  return allOk;
}

async function main() {
  console.log('\n');
  log.header('VERIFICACION DE DESPLIEGUE - PROJECT PULSE BOT');

  const results = {
    environment: await verifyEnvironment(),
    dynamodb: await verifyDynamoDB(),
    slack: await verifySlack(),
    asana: await verifyAsana()
  };

  log.header('RESUMEN');

  const allPassed = Object.values(results).every(r => r);

  console.log(`
  Environment: ${results.environment ? '✅' : '❌'}
  DynamoDB:    ${results.dynamodb ? '✅' : '❌'}
  Slack:       ${results.slack ? '✅' : '❌'}
  Asana:       ${results.asana ? '✅' : '❌'}
  `);

  if (allPassed) {
    log.success('Todas las verificaciones pasaron!');
    log.info('El sistema está listo para usar.');
  } else {
    log.error('Algunas verificaciones fallaron.');
    log.info('Revisar los errores arriba y corregir antes de continuar.');
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  log.error(`Error fatal: ${error.message}`);
  process.exit(1);
});

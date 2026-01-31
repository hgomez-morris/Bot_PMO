/**
 * Script para pre-cachear los proyectos de un usuario en DynamoDB
 *
 * Uso: node scripts/cache-user-projects.js <slackUserId> [projectGids separados por coma]
 *
 * Ejemplo:
 *   node scripts/cache-user-projects.js U12345678
 *   node scripts/cache-user-projects.js U12345678 1210990266108346,1211176915256879
 */

require('dotenv').config({ path: '.env.local' });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const Asana = require('asana');

const slackUserId = process.argv[2];
const projectGidsArg = process.argv[3];

if (!slackUserId) {
  console.error('Uso: node scripts/cache-user-projects.js <slackUserId> [projectGids]');
  console.error('Ejemplo: node scripts/cache-user-projects.js U12345678');
  process.exit(1);
}

// Harold's known projects from the full search
const HAROLD_PROJECTS = [
  { gid: '1210990266108346', name: 'Soporte recurrente - Proyecto ESCALONAMIENTO PARA EXTRACCIÓN REMOTA TRENES NS93 DE LÍNEA 1' },
  { gid: '1211176915256879', name: 'Implementación Escalonamiento para Extracción Remota trenes NS93 de Línea 1' },
  { gid: '1211360380436621', name: 'Capacitación en plataforma de gestión de proyecto Jira' },
  { gid: '1211516337735726', name: 'Migración desde GCP hacia AWS - Cliente Amplifica' },
  { gid: '1212222424473621', name: 'Fin Flow en AWS Automatización, Contenedores y Buenas Prácticas Cloud - Asicom' },
  { gid: '1212222726479899', name: 'PoC Project Plan IASA' },
  { gid: '1212618647720300', name: 'Migración de Infraestructura desde Azure hacia AWS' },
  { gid: '1212912868440565', name: 'Automatización gestión de cuentas AWS' }
];

async function main() {
  // Configurar DynamoDB
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(client);
  const USERS_TABLE = process.env.USERS_TABLE || 'pmo-bot-users-dev';
  // Forzar tabla dev si no está configurada correctamente
  const finalTable = USERS_TABLE.includes('-dev') ? USERS_TABLE : 'pmo-bot-users-dev';

  console.log(`Usando tabla: ${finalTable}`);
  console.log(`Slack User ID: ${slackUserId}`);

  // Verificar que el usuario existe
  try {
    const getResult = await docClient.send(new GetCommand({
      TableName: finalTable,
      Key: { pk: `USER#${slackUserId}` }
    }));

    if (!getResult.Item) {
      console.error(`Usuario ${slackUserId} no encontrado en DynamoDB`);
      console.log('\nUsuarios disponibles: (run aws dynamodb scan to list)');
      process.exit(1);
    }

    console.log(`Usuario encontrado: ${getResult.Item.asanaName || 'Sin nombre'}`);
  } catch (error) {
    console.error('Error verificando usuario:', error.message);
    process.exit(1);
  }

  let projects = HAROLD_PROJECTS;

  // Si se pasaron GIDs específicos, obtener los nombres de Asana
  if (projectGidsArg) {
    const pat = process.env.ASANA_PAT;
    if (!pat) {
      console.error('ASANA_PAT requerido para obtener nombres de proyectos');
      process.exit(1);
    }

    const asanaClient = Asana.ApiClient.instance;
    asanaClient.authentications['token'].accessToken = pat;
    const projectsApi = new Asana.ProjectsApi();

    const gids = projectGidsArg.split(',');
    projects = [];

    for (const gid of gids) {
      try {
        const response = await projectsApi.getProject(gid.trim(), { opt_fields: 'name' });
        projects.push({ gid: gid.trim(), name: response.data.name });
        console.log(`  Encontrado: ${response.data.name}`);
      } catch (err) {
        console.error(`  Error obteniendo proyecto ${gid}: ${err.message}`);
      }
    }
  }

  // Guardar en cache
  try {
    await docClient.send(new UpdateCommand({
      TableName: finalTable,
      Key: { pk: `USER#${slackUserId}` },
      UpdateExpression: 'SET #projects = :projects, #projectsCachedAt = :cachedAt',
      ExpressionAttributeNames: {
        '#projects': 'cachedProjects',
        '#projectsCachedAt': 'projectsCachedAt'
      },
      ExpressionAttributeValues: {
        ':projects': projects,
        ':cachedAt': new Date().toISOString()
      }
    }));

    console.log(`\n✅ Cache guardado: ${projects.length} proyectos`);
    projects.forEach(p => console.log(`  • ${p.name}`));

  } catch (error) {
    console.error('Error guardando cache:', error.message);
    process.exit(1);
  }
}

main();

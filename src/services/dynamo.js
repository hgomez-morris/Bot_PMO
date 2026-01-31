/**
 * DynamoDB Service
 *
 * Maneja todas las operaciones con DynamoDB.
 *
 * Tablas:
 * - pmo-bot-users: Usuarios (PMs)
 * - pmo-bot-updates: Updates de proyectos
 * - pmo-bot-conversations: Estado de conversaciones (opcional)
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 1.3
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand
} = require('@aws-sdk/lib-dynamodb');

// Configuración del cliente
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);

// Nombres de tablas desde variables de entorno
const USERS_TABLE = process.env.USERS_TABLE || 'pmo-bot-users';
const UPDATES_TABLE = process.env.UPDATES_TABLE || 'pmo-bot-updates';
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || 'pmo-bot-conversations';

/**
 * Obtiene un usuario por su Slack User ID
 * @param {string} slackUserId
 * @returns {Object|null}
 */
async function getUser(slackUserId) {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { pk: `USER#${slackUserId}` }
    }));
    return response.Item || null;
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    throw error;
  }
}

/**
 * Guarda un nuevo usuario
 * @param {Object} userData - { slackUserId, asanaEmail, timezone, onboarded }
 */
async function saveUser(userData) {
  const item = {
    pk: `USER#${userData.slackUserId}`,
    slackUserId: userData.slackUserId,
    asanaEmail: userData.asanaEmail || null,
    timezone: userData.timezone || null,
    onboarded: userData.onboarded || false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: item
    }));
    return item;
  } catch (error) {
    console.error('Error guardando usuario:', error);
    throw error;
  }
}

/**
 * Actualiza campos de un usuario existente
 * @param {string} slackUserId
 * @param {Object} updates - Campos a actualizar
 */
async function updateUser(slackUserId, updates) {
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(updates).forEach(([key, value], index) => {
    updateExpressions.push(`#field${index} = :value${index}`);
    expressionAttributeNames[`#field${index}`] = key;
    expressionAttributeValues[`:value${index}`] = value;
  });

  // Siempre actualizar updatedAt
  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { pk: `USER#${slackUserId}` },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }));
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    throw error;
  }
}

/**
 * Obtiene todos los usuarios onboarded
 * @returns {Array}
 */
async function getAllOnboardedUsers() {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: 'onboarded = :onboarded',
      ExpressionAttributeValues: { ':onboarded': true }
    }));
    return response.Items || [];
  } catch (error) {
    console.error('Error obteniendo usuarios onboarded:', error);
    throw error;
  }
}

/**
 * Guarda un update de proyecto
 * @param {Object} updateData
 */
async function saveUpdate(updateData) {
  const timestamp = new Date().toISOString();
  const item = {
    pk: `PROJECT#${updateData.projectGid}`,
    sk: `UPDATE#${timestamp}`,
    projectGid: updateData.projectGid,
    projectName: updateData.projectName,
    pmSlackId: updateData.pmSlackId,
    status: updateData.status,
    advances: updateData.advances,
    hasBlockers: updateData.hasBlockers,
    blockerDescription: updateData.blockerDescription || null,
    timestamp
  };

  try {
    await docClient.send(new PutCommand({
      TableName: UPDATES_TABLE,
      Item: item
    }));
    return item;
  } catch (error) {
    console.error('Error guardando update:', error);
    throw error;
  }
}

/**
 * Obtiene los últimos N updates de un proyecto
 * @param {string} projectGid
 * @param {number} limit
 * @returns {Array}
 */
async function getLastUpdates(projectGid, limit = 2) {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: UPDATES_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `PROJECT#${projectGid}` },
      ScanIndexForward: false, // Orden descendente
      Limit: limit
    }));
    return response.Items || [];
  } catch (error) {
    console.error('Error obteniendo últimos updates:', error);
    throw error;
  }
}

/**
 * Obtiene lista de projectGid que ya tienen update hoy
 * @returns {Array<string>}
 */
async function getProjectsUpdatedToday() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const response = await docClient.send(new ScanCommand({
      TableName: UPDATES_TABLE,
      FilterExpression: 'begins_with(sk, :today)',
      ExpressionAttributeValues: { ':today': `UPDATE#${today}` },
      ProjectionExpression: 'projectGid'
    }));

    // Extraer projectGids únicos
    const projectGids = new Set();
    (response.Items || []).forEach(item => projectGids.add(item.projectGid));
    return Array.from(projectGids);
  } catch (error) {
    console.error('Error obteniendo proyectos actualizados hoy:', error);
    throw error;
  }
}

// Funciones para estado de conversación
async function getConversationState(slackUserId) {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { pk: `CONV#${slackUserId}` }
    }));
    return response.Item || null;
  } catch (error) {
    console.error('Error obteniendo estado de conversación:', error);
    return null;
  }
}

async function setConversationState(slackUserId, state) {
  const item = {
    pk: `CONV#${slackUserId}`,
    ...state,
    updatedAt: new Date().toISOString(),
    // TTL de 1 hora
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  };

  try {
    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: item
    }));
  } catch (error) {
    console.error('Error guardando estado de conversación:', error);
    throw error;
  }
}

async function clearConversationState(slackUserId) {
  // Simplemente sobreescribir con estado vacío o dejar que expire
  try {
    await setConversationState(slackUserId, { cleared: true });
  } catch (error) {
    console.error('Error limpiando estado de conversación:', error);
  }
}

/**
 * Elimina un usuario
 * @param {string} slackUserId
 */
async function deleteUser(slackUserId) {
  try {
    await docClient.send(new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { pk: `USER#${slackUserId}` }
    }));
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    throw error;
  }
}

/**
 * Guarda los proyectos cacheados de un usuario
 * @param {string} slackUserId
 * @param {Array<{gid: string, name: string}>} projects
 */
async function cacheUserProjects(slackUserId, projects) {
  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
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
    console.log(`[DynamoDB] Cacheados ${projects.length} proyectos para usuario ${slackUserId}`);
  } catch (error) {
    console.error('Error cacheando proyectos:', error);
    // No propagamos el error - el cache es opcional
  }
}

/**
 * Obtiene los proyectos cacheados de un usuario
 * @param {string} slackUserId
 * @returns {{projects: Array, cachedAt: string}|null}
 */
async function getCachedUserProjects(slackUserId) {
  try {
    const user = await getUser(slackUserId);
    if (user?.cachedProjects && user?.projectsCachedAt) {
      // Verificar si el cache tiene menos de 24 horas
      const cacheAge = Date.now() - new Date(user.projectsCachedAt).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 horas

      if (cacheAge < maxAge) {
        return {
          projects: user.cachedProjects,
          cachedAt: user.projectsCachedAt
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error obteniendo proyectos cacheados:', error);
    return null;
  }
}

module.exports = {
  getUser,
  saveUser,
  updateUser,
  deleteUser,
  getAllOnboardedUsers,
  saveUpdate,
  getLastUpdates,
  getProjectsUpdatedToday,
  getConversationState,
  setConversationState,
  clearConversationState,
  cacheUserProjects,
  getCachedUserProjects
};

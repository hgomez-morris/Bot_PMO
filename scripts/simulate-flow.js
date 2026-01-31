/**
 * simulate-flow.js - Simulación E2E del flujo completo
 *
 * Simula el flujo completo sin necesidad de Slack/Asana reales.
 * Útil para testing y demos.
 *
 * Uso: npm run simulate
 */

// Colores para output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = {
  step: (num, msg) => console.log(`\n${colors.cyan}${colors.bold}[PASO ${num}]${colors.reset} ${msg}`),
  action: (msg) => console.log(`  ${colors.yellow}→${colors.reset} ${msg}`),
  success: (msg) => console.log(`  ${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`  ${colors.red}✗${colors.reset} ${msg}`),
  data: (label, data) => console.log(`  ${colors.magenta}${label}:${colors.reset}`, JSON.stringify(data, null, 2)),
  separator: () => console.log(`\n${colors.cyan}${'─'.repeat(60)}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.cyan}${colors.bold}${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}${colors.reset}`)
};

// Mock de servicios
const mockDB = {
  users: new Map(),
  updates: new Map(),
  conversations: new Map()
};

const mockDynamoService = {
  getUser: async (slackUserId) => {
    return mockDB.users.get(`USER#${slackUserId}`) || null;
  },
  saveUser: async (userData) => {
    const item = {
      pk: `USER#${userData.slackUserId}`,
      ...userData,
      createdAt: new Date().toISOString()
    };
    mockDB.users.set(item.pk, item);
    return item;
  },
  updateUser: async (slackUserId, updates) => {
    const key = `USER#${slackUserId}`;
    const existing = mockDB.users.get(key);
    if (existing) {
      mockDB.users.set(key, { ...existing, ...updates, updatedAt: new Date().toISOString() });
    }
  },
  getAllOnboardedUsers: async () => {
    return Array.from(mockDB.users.values()).filter(u => u.onboarded);
  },
  saveUpdate: async (updateData) => {
    const timestamp = new Date().toISOString();
    const item = {
      pk: `PROJECT#${updateData.projectGid}`,
      sk: `UPDATE#${timestamp}`,
      ...updateData,
      timestamp
    };
    const key = `${item.pk}#${item.sk}`;
    mockDB.updates.set(key, item);
    return item;
  },
  getLastUpdates: async (projectGid, limit = 2) => {
    const updates = Array.from(mockDB.updates.values())
      .filter(u => u.pk === `PROJECT#${projectGid}`)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
    return updates;
  },
  getConversationState: async (slackUserId) => {
    return mockDB.conversations.get(`CONV#${slackUserId}`) || null;
  },
  setConversationState: async (slackUserId, state) => {
    mockDB.conversations.set(`CONV#${slackUserId}`, { ...state, slackUserId });
  },
  clearConversationState: async (slackUserId) => {
    mockDB.conversations.delete(`CONV#${slackUserId}`);
  }
};

const mockSlackService = {
  messages: [],
  alerts: [],
  sendMessage: async (channel, text, blocks) => {
    const msg = { channel, text, blocks, timestamp: new Date().toISOString() };
    mockSlackService.messages.push(msg);
    log.action(`Mensaje enviado a ${channel}: ${text || '(blocks)'}`);
    return msg;
  },
  sendUpdateRequest: async (slackUserId, projectName, projectGid) => {
    log.action(`Solicitud de update enviada a ${slackUserId} para "${projectName}"`);
    mockSlackService.messages.push({
      type: 'update_request',
      to: slackUserId,
      projectName,
      projectGid
    });
  },
  sendAlertToPMO: async (projectName, pmSlackId, status, advances, hasBlockers) => {
    const alert = { projectName, pmSlackId, status, advances, hasBlockers };
    mockSlackService.alerts.push(alert);
    log.action(`🚨 ALERTA enviada a PMO: ${projectName} - ${status}`);
  }
};

const mockAsanaService = {
  projects: [
    { gid: 'proj-001', name: 'Migración AWS - Cliente Alpha' },
    { gid: 'proj-002', name: 'Migración AWS - Cliente Beta' },
    { gid: 'proj-003', name: 'Migración AWS - Cliente Gamma' }
  ],
  getProjectsForUser: async (email) => {
    log.action(`Consultando proyectos de Asana para ${email}`);
    return mockAsanaService.projects;
  },
  getUserByEmail: async (email) => {
    return { gid: 'user-001', name: 'PM Test', email };
  }
};

// Importar lógica real
const riskDetector = require('../src/lib/risk-detector');
const messages = require('../src/lib/messages');

// Simulaciones
async function simulateOnboarding() {
  log.header('SIMULACIÓN: ONBOARDING DE PM');

  const pmSlackId = 'U_PM_001';
  const pmEmail = 'pm.test@empresa.com';
  const pmTimezone = 'America/Santiago';

  log.step(1, 'PM envía primer mensaje al bot');
  log.action('PM escribe: "Hola"');

  log.step(2, 'Bot detecta usuario nuevo y pide email');
  const emailBlocks = messages.getOnboardingEmailBlocks();
  log.success('Mensaje de onboarding enviado');

  log.step(3, 'PM responde con email de Asana');
  log.action(`PM escribe: "${pmEmail}"`);

  // Verificar en Asana
  const asanaUser = await mockAsanaService.getUserByEmail(pmEmail);
  if (asanaUser) {
    log.success(`Usuario encontrado en Asana: ${asanaUser.name}`);
  }

  log.step(4, 'Bot pide timezone');
  const tzBlocks = messages.getOnboardingTimezoneBlocks();
  log.success('Opciones de timezone enviadas');

  log.step(5, 'PM selecciona timezone');
  log.action(`PM selecciona: ${pmTimezone}`);

  // Guardar usuario
  await mockDynamoService.saveUser({
    slackUserId: pmSlackId,
    asanaEmail: pmEmail,
    timezone: pmTimezone,
    onboarded: true
  });

  log.step(6, 'Bot confirma onboarding completo');
  const completeBlocks = messages.getOnboardingCompleteBlocks(pmTimezone);
  log.success('Onboarding completado');

  // Verificar
  const savedUser = await mockDynamoService.getUser(pmSlackId);
  log.data('Usuario guardado', savedUser);

  return savedUser;
}

async function simulateUpdateRequest(user) {
  log.header('SIMULACIÓN: SOLICITUD DE UPDATE');

  log.step(1, 'EventBridge dispara función scheduled-pulse');
  log.action('Día: Lunes 9:00 AM');

  log.step(2, 'Obtener usuarios onboarded');
  const users = await mockDynamoService.getAllOnboardedUsers();
  log.success(`${users.length} usuario(s) encontrado(s)`);

  log.step(3, 'Para cada usuario, obtener proyectos de Asana');
  const projects = await mockAsanaService.getProjectsForUser(user.asanaEmail);
  log.success(`${projects.length} proyecto(s) encontrado(s)`);

  log.step(4, 'Enviar solicitud de update para cada proyecto');
  for (const project of projects) {
    await mockSlackService.sendUpdateRequest(user.slackUserId, project.name, project.gid);

    // Simular que el bot envía el mensaje con botones
    const blocks = messages.getUpdateRequestBlocks(project.name, project.gid);
    log.success(`Solicitud enviada para: ${project.name}`);
  }

  return projects;
}

async function simulateUpdateResponse(user, project, status, hasBlockers, advances) {
  log.header(`SIMULACIÓN: RESPUESTA DE UPDATE (${status.toUpperCase()})`);

  log.step(1, 'PM hace clic en botón de estado');
  log.action(`PM selecciona: ${messages.getStatusEmoji(status)} ${status}`);

  // Guardar estado de conversación
  await mockDynamoService.setConversationState(user.slackUserId, {
    step: 'awaiting_blockers',
    projectGid: project.gid,
    projectName: project.name,
    status
  });

  log.step(2, 'PM hace clic en botón de bloqueos');
  log.action(`PM selecciona: ${hasBlockers ? 'Sí hay bloqueos' : 'No hay bloqueos'}`);

  await mockDynamoService.setConversationState(user.slackUserId, {
    step: 'awaiting_advances',
    projectGid: project.gid,
    projectName: project.name,
    status,
    hasBlockers
  });

  log.step(3, 'PM escribe avances');
  log.action(`PM escribe: "${advances}"`);

  log.step(4, 'Bot guarda update en DynamoDB');
  const update = await mockDynamoService.saveUpdate({
    projectGid: project.gid,
    projectName: project.name,
    pmSlackId: user.slackUserId,
    status,
    advances,
    hasBlockers,
    blockerDescription: hasBlockers ? 'Esperando accesos del cliente' : null
  });
  log.success('Update guardado');
  log.data('Update', update);

  log.step(5, 'Bot evalúa riesgo');
  const previousUpdates = await mockDynamoService.getLastUpdates(project.gid, 2);
  const riskResult = riskDetector.shouldAlert(
    { status, hasBlockers },
    previousUpdates.slice(1) // Excluir el update actual
  );

  if (riskResult.shouldAlert) {
    log.action(`⚠️ Condición de alerta detectada: ${riskResult.reason}`);

    log.step(6, 'Bot envía alerta a PMO');
    await mockSlackService.sendAlertToPMO(
      project.name,
      user.slackUserId,
      status,
      advances,
      hasBlockers
    );
    log.success('Alerta enviada al canal #pmo-status');
  } else {
    log.success('No se requiere alerta');
  }

  // Limpiar estado de conversación
  await mockDynamoService.clearConversationState(user.slackUserId);

  return update;
}

async function simulateConsecutiveAtRisk(user, project) {
  log.header('SIMULACIÓN: AT RISK CONSECUTIVO (ALERTA)');

  // Primer update at_risk
  log.step(1, 'Primer update: at_risk');
  await simulateUpdateResponse(
    user,
    project,
    'at_risk',
    false,
    'Retrasos menores en accesos'
  );

  // Simular que pasan unos días
  log.separator();
  log.action('... pasan 3 días (Jueves) ...');
  log.separator();

  // Segundo update at_risk
  log.step(2, 'Segundo update: at_risk (debería generar alerta)');
  await simulateUpdateResponse(
    user,
    project,
    'at_risk',
    true,
    'Sigue el retraso, ahora con bloqueo de accesos'
  );
}

async function simulateWeeklySummary() {
  log.header('SIMULACIÓN: RESUMEN SEMANAL');

  log.step(1, 'Obtener todos los updates de la semana');
  const allUpdates = Array.from(mockDB.updates.values());
  log.success(`${allUpdates.length} updates encontrados`);

  log.step(2, 'Generar estadísticas');
  const stats = {
    total: allUpdates.length,
    byStatus: {},
    withBlockers: 0
  };

  allUpdates.forEach(u => {
    stats.byStatus[u.status] = (stats.byStatus[u.status] || 0) + 1;
    if (u.hasBlockers) stats.withBlockers++;
  });

  log.data('Estadísticas', stats);

  log.step(3, 'Generar resumen para PMO');
  const summary = `
📊 *Resumen Semanal PMO*

*Estado General*
• 🟢 On Track: ${stats.byStatus.on_track || 0}
• 🟡 At Risk: ${stats.byStatus.at_risk || 0}
• 🔴 Off Track: ${stats.byStatus.off_track || 0}

*Bloqueos Activos*: ${stats.withBlockers}

*Alertas Generadas*: ${mockSlackService.alerts.length}
  `;

  log.action('Resumen generado:');
  console.log(summary);

  log.success('Resumen semanal completado');
}

async function runFullSimulation() {
  console.log('\n');
  log.header('🚀 SIMULACIÓN COMPLETA - PROJECT PULSE BOT');
  console.log('\nEsta simulación demuestra el flujo completo del bot sin servicios externos.\n');

  try {
    // 1. Onboarding
    const user = await simulateOnboarding();

    log.separator();

    // 2. Solicitud de updates
    const projects = await simulateUpdateRequest(user);

    log.separator();

    // 3. Respuesta normal (on_track)
    await simulateUpdateResponse(
      user,
      projects[0],
      'on_track',
      false,
      'Migración de base de datos completada. Iniciando pruebas de conectividad.'
    );

    log.separator();

    // 4. Respuesta con alerta (off_track)
    await simulateUpdateResponse(
      user,
      projects[1],
      'off_track',
      true,
      'Bloqueados por falta de accesos a producción. Cliente no responde.'
    );

    log.separator();

    // 5. At risk consecutivo
    await simulateConsecutiveAtRisk(user, projects[2]);

    log.separator();

    // 6. Resumen semanal
    await simulateWeeklySummary();

    // Resumen final
    log.header('📋 RESUMEN DE LA SIMULACIÓN');

    console.log(`
${colors.green}Resultados:${colors.reset}
• Usuarios onboarded: ${mockDB.users.size}
• Updates registrados: ${mockDB.updates.size}
• Mensajes enviados: ${mockSlackService.messages.length}
• Alertas generadas: ${mockSlackService.alerts.length}

${colors.yellow}Alertas:${colors.reset}`);

    mockSlackService.alerts.forEach((alert, i) => {
      console.log(`  ${i + 1}. ${alert.projectName} - ${messages.getStatusEmoji(alert.status)} ${alert.status}`);
    });

    console.log(`
${colors.cyan}La simulación demuestra:${colors.reset}
✓ Onboarding de PM
✓ Solicitud de updates (Lunes/Jueves)
✓ Respuesta con botones + texto
✓ Detección de riesgos
✓ Alertas automáticas a PMO
✓ Resumen semanal
`);

    log.success('Simulación completada exitosamente');

  } catch (error) {
    log.error(`Error en simulación: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar
runFullSimulation();

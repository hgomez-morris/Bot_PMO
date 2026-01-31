/**
 * monitor-pilot.js - Dashboard de monitoreo para el piloto
 *
 * Muestra estadísticas en tiempo real del piloto.
 *
 * Uso: npm run monitor
 */

require('dotenv').config({ path: '.env.local' });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Configuración
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const USERS_TABLE = process.env.USERS_TABLE || 'pmo-bot-users-dev';
const UPDATES_TABLE = process.env.UPDATES_TABLE || 'pmo-bot-updates-dev';

// Colores
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m'
};

function clearScreen() {
  console.clear();
}

function header(text) {
  const line = '═'.repeat(60);
  console.log(`${c.cyan}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}  ${text}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}\n`);
}

function section(title) {
  console.log(`\n${c.yellow}${c.bold}▸ ${title}${c.reset}\n`);
}

function statusEmoji(status) {
  const emojis = { on_track: '🟢', at_risk: '🟡', off_track: '🔴' };
  return emojis[status] || '⚪';
}

async function getUsers() {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: USERS_TABLE
    }));
    return response.Items || [];
  } catch (error) {
    console.error('Error obteniendo usuarios:', error.message);
    return [];
  }
}

async function getUpdates(daysBack = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  const startDateStr = startDate.toISOString().split('T')[0];

  try {
    const response = await docClient.send(new ScanCommand({
      TableName: UPDATES_TABLE,
      FilterExpression: 'sk >= :startDate',
      ExpressionAttributeValues: {
        ':startDate': `UPDATE#${startDateStr}`
      }
    }));
    return response.Items || [];
  } catch (error) {
    console.error('Error obteniendo updates:', error.message);
    return [];
  }
}

function analyzeUsers(users) {
  const total = users.length;
  const onboarded = users.filter(u => u.onboarded).length;
  const pending = total - onboarded;

  const byTimezone = {};
  users.forEach(u => {
    if (u.timezone) {
      byTimezone[u.timezone] = (byTimezone[u.timezone] || 0) + 1;
    }
  });

  return { total, onboarded, pending, byTimezone };
}

function analyzeUpdates(updates) {
  const total = updates.length;

  const byStatus = { on_track: 0, at_risk: 0, off_track: 0 };
  const byProject = {};
  const byDay = {};
  let withBlockers = 0;

  updates.forEach(u => {
    // Por estado
    if (byStatus.hasOwnProperty(u.status)) {
      byStatus[u.status]++;
    }

    // Por proyecto
    byProject[u.projectGid] = byProject[u.projectGid] || { name: u.projectName, count: 0, lastStatus: null };
    byProject[u.projectGid].count++;
    byProject[u.projectGid].lastStatus = u.status;

    // Por día
    const day = u.timestamp?.split('T')[0] || 'unknown';
    byDay[day] = (byDay[day] || 0) + 1;

    // Bloqueos
    if (u.hasBlockers) withBlockers++;
  });

  return { total, byStatus, byProject, byDay, withBlockers };
}

function calculateResponseRate(updates, users, days = 7) {
  // Asumiendo 2 solicitudes por semana (Lun y Jue)
  const expectedPerUser = Math.floor(days / 7) * 2 + (days % 7 >= 4 ? 1 : 0) + (days % 7 >= 1 ? 1 : 0);
  const onboardedUsers = users.filter(u => u.onboarded).length;
  const expectedTotal = onboardedUsers * expectedPerUser * 3; // Asumiendo ~3 proyectos por PM

  if (expectedTotal === 0) return 0;
  return Math.min(100, Math.round((updates.length / expectedTotal) * 100));
}

function printBar(value, max, width = 30) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

async function displayDashboard() {
  clearScreen();

  const timestamp = new Date().toLocaleString('es-CL');
  header(`PROJECT PULSE BOT - MONITOR DE PILOTO`);
  console.log(`${c.white}Última actualización: ${timestamp}${c.reset}`);

  // Obtener datos
  console.log(`\n${c.cyan}Cargando datos...${c.reset}`);
  const [users, updates] = await Promise.all([
    getUsers(),
    getUpdates(7)
  ]);

  const userStats = analyzeUsers(users);
  const updateStats = analyzeUpdates(updates);
  const responseRate = calculateResponseRate(updates, users, 7);

  clearScreen();
  header(`PROJECT PULSE BOT - MONITOR DE PILOTO`);
  console.log(`${c.white}Última actualización: ${timestamp}${c.reset}`);

  // Sección: Usuarios
  section('USUARIOS');
  console.log(`  Total registrados:  ${c.bold}${userStats.total}${c.reset}`);
  console.log(`  Onboarded:          ${c.green}${userStats.onboarded}${c.reset}`);
  console.log(`  Pendientes:         ${c.yellow}${userStats.pending}${c.reset}`);

  if (Object.keys(userStats.byTimezone).length > 0) {
    console.log(`\n  Por timezone:`);
    Object.entries(userStats.byTimezone).forEach(([tz, count]) => {
      const tzShort = tz.split('/')[1] || tz;
      console.log(`    ${tzShort}: ${count}`);
    });
  }

  // Sección: Updates (últimos 7 días)
  section('UPDATES (Últimos 7 días)');
  console.log(`  Total:              ${c.bold}${updateStats.total}${c.reset}`);
  console.log(`  Con bloqueos:       ${c.red}${updateStats.withBlockers}${c.reset}`);

  console.log(`\n  Por estado:`);
  const maxStatus = Math.max(...Object.values(updateStats.byStatus), 1);
  console.log(`    🟢 On Track:   ${updateStats.byStatus.on_track.toString().padStart(3)} ${printBar(updateStats.byStatus.on_track, maxStatus, 20)}`);
  console.log(`    🟡 At Risk:    ${updateStats.byStatus.at_risk.toString().padStart(3)} ${printBar(updateStats.byStatus.at_risk, maxStatus, 20)}`);
  console.log(`    🔴 Off Track:  ${updateStats.byStatus.off_track.toString().padStart(3)} ${printBar(updateStats.byStatus.off_track, maxStatus, 20)}`);

  // Sección: Proyectos
  section('PROYECTOS');
  const projects = Object.entries(updateStats.byProject);
  if (projects.length === 0) {
    console.log(`  ${c.yellow}No hay proyectos con updates aún${c.reset}`);
  } else {
    projects
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .forEach(([gid, data]) => {
        const name = (data.name || gid).substring(0, 35).padEnd(35);
        const emoji = statusEmoji(data.lastStatus);
        console.log(`  ${emoji} ${name} (${data.count} updates)`);
      });
  }

  // Sección: Métricas Clave
  section('MÉTRICAS CLAVE');

  const rateColor = responseRate >= 80 ? c.green : responseRate >= 50 ? c.yellow : c.red;
  console.log(`  Tasa de respuesta:  ${rateColor}${responseRate}%${c.reset} ${printBar(responseRate, 100, 20)} (objetivo: ≥80%)`);

  const blockersPercent = updateStats.total > 0 ? Math.round((updateStats.withBlockers / updateStats.total) * 100) : 0;
  console.log(`  Updates con bloqueos: ${blockersPercent}%`);

  const riskPercent = updateStats.total > 0 ?
    Math.round(((updateStats.byStatus.at_risk + updateStats.byStatus.off_track) / updateStats.total) * 100) : 0;
  const riskColor = riskPercent <= 20 ? c.green : riskPercent <= 40 ? c.yellow : c.red;
  console.log(`  Proyectos en riesgo: ${riskColor}${riskPercent}%${c.reset}`);

  // Sección: Actividad por día
  section('ACTIVIDAD POR DÍA');
  const days = Object.entries(updateStats.byDay).sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length === 0) {
    console.log(`  ${c.yellow}Sin actividad registrada${c.reset}`);
  } else {
    const maxDay = Math.max(...days.map(d => d[1]), 1);
    days.slice(-7).forEach(([day, count]) => {
      const dayName = new Date(day + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' });
      console.log(`  ${dayName.padEnd(10)} ${count.toString().padStart(3)} ${printBar(count, maxDay, 25)}`);
    });
  }

  // Footer
  console.log(`\n${c.cyan}${'─'.repeat(60)}${c.reset}`);
  console.log(`${c.white}Presiona Ctrl+C para salir | Actualiza cada 30 segundos${c.reset}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch') || args.includes('-w');

  if (isWatch) {
    // Modo watch: actualizar cada 30 segundos
    await displayDashboard();
    setInterval(displayDashboard, 30000);
  } else {
    // Una sola vez
    await displayDashboard();
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

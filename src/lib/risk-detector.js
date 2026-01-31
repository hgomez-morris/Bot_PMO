/**
 * Risk Detector
 *
 * Lógica de detección automática de riesgos.
 *
 * Condiciones de alerta:
 * - Proyecto reportado como off_track
 * - Proyecto at_risk por 2 updates consecutivos
 * - Bloqueo reportado en proyecto con riesgo
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 1.7
 */

/**
 * Determina si debe generarse una alerta
 * @param {Object} currentUpdate - { status, hasBlockers }
 * @param {Array} previousUpdates - Updates anteriores (máx 2)
 * @returns {Object} { shouldAlert: boolean, reason: string }
 */
function shouldAlert(currentUpdate, previousUpdates = []) {
  const { status, hasBlockers } = currentUpdate;

  console.log('Evaluando riesgo:', { status, hasBlockers, previousUpdates: previousUpdates.length });

  // Condición A: off_track siempre genera alerta
  if (status === 'off_track') {
    return {
      shouldAlert: true,
      reason: 'Proyecto reportado como Off Track'
    };
  }

  // Condición B: at_risk consecutivo
  if (status === 'at_risk' && previousUpdates.length > 0) {
    const lastUpdate = previousUpdates[0];
    if (lastUpdate && lastUpdate.status === 'at_risk') {
      return {
        shouldAlert: true,
        reason: 'Proyecto en riesgo por 2 reportes consecutivos'
      };
    }
  }

  // Condición C: bloqueo en proyecto con riesgo
  if (hasBlockers && status !== 'on_track') {
    return {
      shouldAlert: true,
      reason: 'Bloqueo reportado en proyecto con riesgo'
    };
  }

  // No hay condiciones de alerta
  return {
    shouldAlert: false,
    reason: null
  };
}

/**
 * Analiza el riesgo de un proyecto basado en su historial
 * @param {string} projectGid
 * @param {Object} dynamoService - Servicio de DynamoDB
 * @returns {Object}
 */
async function analyzeProjectRisk(projectGid, dynamoService) {
  try {
    const updates = await dynamoService.getLastUpdates(projectGid, 3);

    if (updates.length === 0) {
      return {
        riskLevel: 'unknown',
        reason: 'Sin historial de updates',
        alerts: []
      };
    }

    const latestUpdate = updates[0];
    const previousUpdates = updates.slice(1);

    const alertResult = shouldAlert(
      { status: latestUpdate.status, hasBlockers: latestUpdate.hasBlockers },
      previousUpdates
    );

    // Calcular nivel de riesgo
    let riskLevel = 'low';
    const alerts = [];

    if (latestUpdate.status === 'off_track') {
      riskLevel = 'high';
      alerts.push('Estado Off Track');
    } else if (latestUpdate.status === 'at_risk') {
      riskLevel = 'medium';
      alerts.push('Estado At Risk');
    }

    if (latestUpdate.hasBlockers) {
      if (riskLevel === 'low') riskLevel = 'medium';
      alerts.push('Tiene bloqueos activos');
    }

    // Verificar tendencia negativa
    if (previousUpdates.length > 0) {
      const statuses = [latestUpdate.status, ...previousUpdates.map(u => u.status)];
      const riskProgression = statuses.every((s, i) =>
        i === 0 || getRiskScore(s) >= getRiskScore(statuses[i-1])
      );

      if (riskProgression && getRiskScore(latestUpdate.status) > 0) {
        alerts.push('Tendencia de riesgo creciente');
      }
    }

    return {
      riskLevel,
      reason: alertResult.reason,
      alerts,
      shouldAlert: alertResult.shouldAlert,
      latestStatus: latestUpdate.status,
      hasBlockers: latestUpdate.hasBlockers,
      lastUpdateAt: latestUpdate.timestamp
    };

  } catch (error) {
    console.error('Error analizando riesgo del proyecto:', error);
    return {
      riskLevel: 'error',
      reason: 'Error al analizar',
      alerts: ['Error de análisis']
    };
  }
}

/**
 * Obtiene un puntaje numérico de riesgo
 * @param {string} status
 * @returns {number}
 */
function getRiskScore(status) {
  const scores = {
    'on_track': 0,
    'at_risk': 1,
    'off_track': 2
  };
  return scores[status] ?? 0;
}

/**
 * Genera resumen de riesgo para múltiples proyectos
 * @param {Array} projects - Lista de análisis de proyectos
 * @returns {Object}
 */
function generateRiskSummary(projects) {
  const summary = {
    total: projects.length,
    byRiskLevel: {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0
    },
    byStatus: {
      on_track: 0,
      at_risk: 0,
      off_track: 0
    },
    withBlockers: 0,
    needingAlert: []
  };

  for (const project of projects) {
    // Contar por nivel de riesgo
    summary.byRiskLevel[project.riskLevel] =
      (summary.byRiskLevel[project.riskLevel] || 0) + 1;

    // Contar por estado
    if (project.latestStatus) {
      summary.byStatus[project.latestStatus] =
        (summary.byStatus[project.latestStatus] || 0) + 1;
    }

    // Contar bloqueos
    if (project.hasBlockers) {
      summary.withBlockers++;
    }

    // Listar los que necesitan alerta
    if (project.shouldAlert) {
      summary.needingAlert.push({
        projectGid: project.projectGid,
        reason: project.reason
      });
    }
  }

  return summary;
}

module.exports = {
  shouldAlert,
  analyzeProjectRisk,
  getRiskScore,
  generateRiskSummary
};

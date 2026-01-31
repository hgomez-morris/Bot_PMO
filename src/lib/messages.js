/**
 * Messages Templates
 *
 * Templates de mensajes en Slack Block Kit format.
 * Todos los mensajes están en español.
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 1.6
 */

/**
 * Bloques para solicitud de update
 * @param {string} projectName
 * @param {string} projectGid
 * @returns {Array}
 */
function getUpdateRequestBlocks(projectName, projectGid) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Update: ${projectName}`,
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `¡Hola! Es momento del update para *${projectName}*.`
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿Cuál es el estado actual del proyecto?*'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🟢 On Track', emoji: true },
          value: 'on_track',
          action_id: `status_${projectGid}_on_track`,
          style: 'primary'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🟡 At Risk', emoji: true },
          value: 'at_risk',
          action_id: `status_${projectGid}_at_risk`
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔴 Off Track', emoji: true },
          value: 'off_track',
          action_id: `status_${projectGid}_off_track`,
          style: 'danger'
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿Hay bloqueos activos?*'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Sí, hay bloqueos', emoji: true },
          value: 'yes',
          action_id: `blockers_${projectGid}_yes`,
          style: 'danger'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'No hay bloqueos', emoji: true },
          value: 'no',
          action_id: `blockers_${projectGid}_no`
        }
      ]
    }
  ];
}

/**
 * Bloques para pedir nombre (onboarding)
 * @returns {Array}
 */
function getOnboardingNameBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '¡Hola! 👋 Soy *Pulse Bot*.\n\nTe ayudaré a reportar el estado de tus proyectos de forma rápida y estructurada.'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Para comenzar, necesito configurar tu perfil.\n\n*¿Cuál es tu nombre como aparece en el campo "Responsable Proyecto" en Asana?*\n\n_Responde con tu nombre exacto (ej: Harold Gómez)_'
      }
    }
  ];
}

/**
 * Bloques para pedir email de Asana (onboarding) - deprecated, kept for reference
 * @returns {Array}
 */
function getOnboardingEmailBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '¡Hola! 👋 Soy *Pulse Bot*.\n\nTe ayudaré a reportar el estado de tus proyectos de forma rápida y estructurada.'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Para comenzar, necesito configurar tu perfil.\n\n*¿Cuál es tu email de Asana?*\n\n_Responde con tu email (ej: tu.nombre@empresa.com)_'
      }
    }
  ];
}

/**
 * Bloques para selección de timezone (onboarding)
 * @returns {Array}
 */
function getOnboardingTimezoneBlocks() {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '¡Perfecto! ✅\n\n*¿En qué zona horaria te encuentras?*\n\nEsto nos ayuda a enviarte los updates a una hora conveniente.'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🇨🇱 Chile (Santiago)', emoji: true },
          value: 'America/Santiago',
          action_id: 'timezone_America/Santiago'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🇵🇪 Perú (Lima)', emoji: true },
          value: 'America/Lima',
          action_id: 'timezone_America/Lima'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🇨🇴 Colombia (Bogotá)', emoji: true },
          value: 'America/Bogota',
          action_id: 'timezone_America/Bogota'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🇲🇽 México (CDMX)', emoji: true },
          value: 'America/Mexico_City',
          action_id: 'timezone_America/Mexico_City'
        }
      ]
    }
  ];
}

/**
 * Bloques de confirmación de onboarding completado
 * @param {string} timezone
 * @returns {Array}
 */
function getOnboardingCompleteBlocks(timezone) {
  const tzNames = {
    'America/Santiago': 'Chile (Santiago)',
    'America/Lima': 'Perú (Lima)',
    'America/Bogota': 'Colombia (Bogotá)',
    'America/Mexico_City': 'México (CDMX)'
  };

  const tzDisplay = tzNames[timezone] || timezone;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `¡Listo! 🎉\n\nTu perfil está configurado:\n• *Timezone:* ${tzDisplay}\n• *Horario de updates:* 9:00 AM (hora local)\n• *Días:* Lunes y Jueves`
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Recibirás solicitudes de update para tus proyectos. ¡Responderlas toma menos de 1 minuto!\n\nEscribe *ayuda* si necesitas información adicional.'
      }
    }
  ];
}

/**
 * Bloques para alerta a PMO
 * @param {string} projectName
 * @param {string} pmSlackId
 * @param {string} status
 * @param {string} advances
 * @param {boolean} hasBlockers
 * @returns {Array}
 */
function getAlertBlocks(projectName, pmSlackId, status, advances, hasBlockers) {
  const statusEmoji = getStatusEmoji(status);
  const statusText = {
    'on_track': 'On Track',
    'at_risk': 'At Risk',
    'off_track': 'Off Track'
  }[status] || status;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `⚠️ Alerta: ${projectName}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*PM:*\n<@${pmSlackId}>`
        },
        {
          type: 'mrkdwn',
          text: `*Estado:*\n${statusEmoji} ${statusText}`
        },
        {
          type: 'mrkdwn',
          text: `*Bloqueos:*\n${hasBlockers ? '🚫 Sí' : '✅ No'}`
        },
        {
          type: 'mrkdwn',
          text: `*Fecha:*\n${new Date().toLocaleDateString('es-CL')}`
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
        text: `*Avances reportados:*\n>${advances || '_Sin avances reportados_'}`
      }
    }
  ];
}

/**
 * Retorna emoji según status
 * @param {string} status
 * @returns {string}
 */
function getStatusEmoji(status) {
  const emojis = {
    'on_track': '🟢',
    'at_risk': '🟡',
    'off_track': '🔴'
  };
  return emojis[status] || '⚪';
}

/**
 * Mensaje de ayuda
 * @returns {Array}
 */
function getHelpBlocks() {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📚 Ayuda - Project Pulse Bot',
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿Qué es Project Pulse Bot?*\nSoy un asistente que te ayuda a reportar el estado de tus proyectos de forma rápida y estructurada.'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*¿Cómo funciona?*\n1. Recibirás un mensaje los Lunes y Jueves\n2. Selecciona el estado del proyecto (On Track, At Risk, Off Track)\n3. Indica si hay bloqueos\n4. Describe brevemente los avances\n\n¡Toma menos de 1 minuto!'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Comandos disponibles:*\n• `ayuda` - Muestra este mensaje\n• `mis proyectos` - Lista tus proyectos asignados\n• `PMO-XXX` - Busca un proyecto por su ID\n• `reset` - Reinicia tu perfil'
      }
    }
  ];
}

module.exports = {
  getUpdateRequestBlocks,
  getOnboardingNameBlocks,
  getOnboardingEmailBlocks,
  getOnboardingTimezoneBlocks,
  getOnboardingCompleteBlocks,
  getAlertBlocks,
  getStatusEmoji,
  getHelpBlocks
};

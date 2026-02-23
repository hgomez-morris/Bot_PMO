/**
 * Reminder Handler
 *
 * Reintenta solicitudes de update si no hay respuesta despues de 1 hora.
 * Antes de insistir, verifica si el proyecto ya fue actualizado.
 */

const dynamoService = require('../services/dynamo');
const slackService = require('../services/slack');
const conversationState = require('../lib/conversation-state');

exports.handler = async () => {
  const now = new Date();
  const states = await dynamoService.getActiveConversationStates();

  for (const state of states) {
    if (!state.slackUserId || !state.currentProjectGid) {
      continue;
    }

    if (state.snoozeUntil && new Date(state.snoozeUntil) > now) {
      continue;
    }

    if (!state.lastPromptAt) {
      continue;
    }

    const lastPromptAt = new Date(state.lastPromptAt);
    const diffMs = now.getTime() - lastPromptAt.getTime();
    if (diffMs < 60 * 60 * 1000) {
      continue;
    }

    // Verificar si ya se actualizo por otra via
    const lastUpdates = await dynamoService.getLastUpdates(state.currentProjectGid, 1);
    const lastUpdateAt = lastUpdates[0]?.timestamp ? new Date(lastUpdates[0].timestamp) : null;
    if (lastUpdateAt && lastUpdateAt > lastPromptAt) {
      const advanced = await advanceToNextProject(state.slackUserId, state);
      if (!advanced) {
        await conversationState.clearConversationState(state.slackUserId);
      }
      continue;
    }

    // Enviar recordatorio segun el paso
    if (state.step === 'awaiting_status') {
      await slackService.sendUpdateRequest(
        state.slackUserId,
        state.currentProjectName || 'Proyecto',
        state.currentProjectGid
      );
    } else if (state.step === 'awaiting_blockers') {
      await slackService.sendMessage(
        state.slackUserId,
        `Recuerda indicar si hay bloqueos para *${state.currentProjectName || 'el proyecto'}*. ` +
          `Si necesitas mas tiempo, escribe "mas tarde".`
      );
    } else if (state.step === 'awaiting_advances') {
      await slackService.sendMessage(
        state.slackUserId,
        `Recuerda enviar los avances para *${state.currentProjectName || 'el proyecto'}*. ` +
          `Si necesitas mas tiempo, escribe "mas tarde".`
      );
    }

    await conversationState.setConversationState(state.slackUserId, {
      ...state,
      lastPromptAt: new Date().toISOString()
    });
  }

  return { statusCode: 200, body: JSON.stringify({ processed: states.length }) };
};

async function advanceToNextProject(slackUserId, state) {
  const pending = Array.isArray(state.pendingProjects) ? state.pendingProjects : [];
  const currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : 0;
  const nextIndex = currentIndex + 1;

  if (nextIndex >= pending.length) {
    return false;
  }

  const next = pending[nextIndex];
  await conversationState.setConversationState(slackUserId, {
    ...state,
    step: 'awaiting_status',
    currentIndex: nextIndex,
    currentProjectGid: next.gid,
    currentProjectName: next.name,
    currentProjectPmoId: next.pmoId || null,
    status: null,
    hasBlockers: null,
    blockerDescription: null,
    lastPromptAt: new Date().toISOString(),
    snoozeUntil: null
  });

  await slackService.sendUpdateRequest(slackUserId, next.name, next.gid);
  return true;
}

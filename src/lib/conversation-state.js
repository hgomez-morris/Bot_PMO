/**
 * Conversation State Manager
 *
 * Maneja el estado de conversaciones entre interacciones.
 * Usa DynamoDB para persistencia entre invocaciones de Lambda.
 *
 * @see Project_Pulse_Bot_MVP_Implementacion.md - Paso 2.3
 */

const dynamoService = require('../services/dynamo');

/**
 * Obtiene el estado de conversación de un usuario
 * @param {string} slackUserId
 * @returns {Object|null}
 */
async function getConversationState(slackUserId) {
  return await dynamoService.getConversationState(slackUserId);
}

/**
 * Guarda/actualiza el estado de conversación
 * @param {string} slackUserId
 * @param {Object} state - { step, projectGid, projectName, status, hasBlockers, ... }
 */
async function setConversationState(slackUserId, state) {
  const currentState = await getConversationState(slackUserId) || {};

  const newState = {
    ...currentState,
    ...state,
    slackUserId,
    startedAt: currentState.startedAt || new Date().toISOString()
  };

  await dynamoService.setConversationState(slackUserId, newState);
  return newState;
}

/**
 * Limpia el estado de conversación
 * @param {string} slackUserId
 */
async function clearConversationState(slackUserId) {
  await dynamoService.clearConversationState(slackUserId);
}

/**
 * Estados posibles de la conversación
 */
const CONVERSATION_STEPS = {
  // Onboarding
  AWAITING_EMAIL: 'awaiting_email',
  AWAITING_TIMEZONE: 'awaiting_timezone',
  ONBOARDING_COMPLETE: 'onboarding_complete',

  // Update flow
  AWAITING_STATUS: 'awaiting_status',
  AWAITING_BLOCKERS: 'awaiting_blockers',
  AWAITING_BLOCKER_DESCRIPTION: 'awaiting_blocker_description',
  AWAITING_ADVANCES: 'awaiting_advances',
  UPDATE_COMPLETE: 'update_complete'
};

/**
 * Verifica si el usuario está en medio de un flujo de update
 * @param {Object} state
 * @returns {boolean}
 */
function isInUpdateFlow(state) {
  if (!state) return false;

  const updateSteps = [
    CONVERSATION_STEPS.AWAITING_STATUS,
    CONVERSATION_STEPS.AWAITING_BLOCKERS,
    CONVERSATION_STEPS.AWAITING_BLOCKER_DESCRIPTION,
    CONVERSATION_STEPS.AWAITING_ADVANCES
  ];

  return updateSteps.includes(state.step);
}

/**
 * Verifica si el usuario está en onboarding
 * @param {Object} state
 * @returns {boolean}
 */
function isInOnboarding(state) {
  if (!state) return false;

  const onboardingSteps = [
    CONVERSATION_STEPS.AWAITING_EMAIL,
    CONVERSATION_STEPS.AWAITING_TIMEZONE
  ];

  return onboardingSteps.includes(state.step);
}

/**
 * Obtiene el siguiente paso del flujo de update
 * @param {string} currentStep
 * @returns {string}
 */
function getNextUpdateStep(currentStep) {
  const flow = [
    CONVERSATION_STEPS.AWAITING_STATUS,
    CONVERSATION_STEPS.AWAITING_BLOCKERS,
    CONVERSATION_STEPS.AWAITING_ADVANCES,
    CONVERSATION_STEPS.UPDATE_COMPLETE
  ];

  const currentIndex = flow.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === flow.length - 1) {
    return CONVERSATION_STEPS.UPDATE_COMPLETE;
  }

  return flow[currentIndex + 1];
}

module.exports = {
  getConversationState,
  setConversationState,
  clearConversationState,
  CONVERSATION_STEPS,
  isInUpdateFlow,
  isInOnboarding,
  getNextUpdateStep
};

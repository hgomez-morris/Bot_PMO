/**
 * Project Pulse Bot - Entry Point
 *
 * Este archivo sirve como punto de entrada principal para desarrollo local.
 * En AWS Lambda, los handlers individuales son los entry points.
 */

// Exportar handlers para referencia
const slackEvents = require('./handlers/slack-events');
const scheduledPulse = require('./handlers/scheduled-pulse');

// Exportar servicios
const slackService = require('./services/slack');
const asanaService = require('./services/asana');
const dynamoService = require('./services/dynamo');

module.exports = {
  handlers: {
    slackEvents,
    scheduledPulse
  },
  services: {
    slack: slackService,
    asana: asanaService,
    dynamo: dynamoService
  }
};

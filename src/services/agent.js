/**
 * Agent Service - Llama 3 via Groq
 *
 * Procesa lenguaje natural para comandos del bot.
 * Usa Groq (gratis) con Llama 3.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_ID = 'llama-3.1-8b-instant';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_proyecto',
      description: 'Busca un proyecto por su PMO ID (ej: PMO-911)',
      parameters: {
        type: 'object',
        properties: {
          pmo_id: { type: 'string', description: 'El PMO ID del proyecto (ej: PMO-911)' }
        },
        required: ['pmo_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mis_proyectos',
      description: 'Lista los proyectos donde el usuario es responsable',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mostrar_ayuda',
      description: 'Muestra información de ayuda sobre el bot',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'respuesta_directa',
      description: 'Responde directamente al usuario sin ejecutar ninguna acción. Usar para saludos, preguntas generales, o cuando no se requiere acción.',
      parameters: {
        type: 'object',
        properties: {
          mensaje: { type: 'string', description: 'El mensaje a enviar al usuario' }
        },
        required: ['mensaje']
      }
    }
  }
];

const SYSTEM_PROMPT = `Eres Pulse Bot, un asistente de PMO (Project Management Office) para proyectos de migración cloud AWS.

Tu trabajo es ayudar a los Project Managers a:
- Consultar información de sus proyectos
- Buscar proyectos por PMO ID
- Responder preguntas sobre el uso del bot

Reglas:
- Sé conciso y directo
- Responde en español
- Si el mensaje contiene un patr?n PMO-XXXX (ej: PMO-1329), usa buscar_proyecto con ese PMO ID
- Si el usuario saluda, usa respuesta_directa con un saludo breve
- Si pide información de un proyecto específico, usa buscar_proyecto
- Si pregunta por sus proyectos, usa mis_proyectos
- Si pregunta cómo usar el bot, usa mostrar_ayuda
- Si no entiendes qué quiere, usa respuesta_directa pidiendo clarificación
- SIEMPRE usa una de las funciones disponibles, nunca respondas directamente`;

/**
 * Procesa un mensaje con el agente
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} context - Contexto adicional (email, etc)
 * @returns {Object} { tool: string, params: Object } o { response: string }
 */
async function processMessage(userMessage, context = {}) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('GROQ_API_KEY no configurada');
    return { response: 'El agente no está configurado. Usa comandos directos como "ayuda" o "mis proyectos".' };
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 256,
        temperature: 0
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Error de Groq:', error);
      return { response: 'Hubo un error procesando tu mensaje. Intenta de nuevo.' };
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      return { response: 'No entendí tu mensaje. Escribe "ayuda" para ver qué puedo hacer.' };
    }

    // Si hay tool call
    if (choice.message?.tool_calls?.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments || '{}');
      return {
        tool: toolCall.function.name,
        params: args
      };
    }

    // Si hay respuesta directa
    if (choice.message?.content) {
      return { response: choice.message.content };
    }

    return { response: 'No entendí tu mensaje. Escribe "ayuda" para ver qué puedo hacer.' };

  } catch (error) {
    console.error('Error en agente:', error);
    return { response: 'Hubo un error procesando tu mensaje. Intenta de nuevo.' };
  }
}

module.exports = {
  processMessage
};

# Contexto de Desarrollo - Pulse Bot MVP

Este documento contiene el contexto necesario para continuar el desarrollo del bot.

## Estado Actual (2026-01-31)

### Funcionalidades Implementadas

- [x] Onboarding de usuarios (nombre + timezone)
- [x] Comando "ayuda"
- [x] Comando "mis proyectos" (usando cache)
- [x] Comando "PMO-XXX" (busca proyecto por ID)
- [x] Comando "reset" (reinicia perfil)
- [x] Agente de IA con Groq (entiende lenguaje natural)
- [x] Botones interactivos de Slack
- [x] Sistema de cache de proyectos en DynamoDB
- [x] Flujo de update request (status, blockers, advances)
- [x] Detección de riesgos
- [x] Alertas al canal PMO
- [x] Despliegue automático con SAM CLI

### Funcionalidades Pendientes

- [ ] **Sincronización automática del cache de proyectos**
- [ ] Refresh de cache en ScheduledPulse
- [ ] Webhooks de Asana para actualizaciones en tiempo real
- [ ] Tests unitarios completos
- [ ] Tests de integración

---

## Problema Principal: Cache de Proyectos

### Contexto

Asana tiene ~1400 proyectos. Para encontrar los proyectos de un PM, hay que:
1. Listar todos los proyectos (paginado, 14 páginas de 100)
2. Para cada proyecto, hacer una llamada API para obtener custom_fields
3. Filtrar por campo "Responsable Proyecto"

**Tiempo total: ~19 minutos** (72 proyectos/minuto)

### Limitaciones

- Lambda timeout máximo: 15 minutos
- API Gateway timeout: 29 segundos
- No hay forma de filtrar por custom fields en Asana API

### Solución Actual

Cache manual en DynamoDB:
```javascript
// En dynamo.js
cacheUserProjects(slackUserId, projects)  // Guarda
getCachedUserProjects(slackUserId)        // Lee (válido 24h)
```

### Usuarios con Cache

| Slack ID | Nombre | Proyectos |
|----------|--------|-----------|
| U099D8C69RS | Harold Gomez | 8 proyectos |

### Cómo Agregar Nuevo Usuario

```bash
# 1. Usuario hace onboarding en Slack (obtiene slackUserId)

# 2. Buscar sus proyectos (LENTO ~19 min)
node scripts/test-asana.js "Nombre Apellido"

# 3. Copiar los GIDs encontrados y cachear
node scripts/cache-user-projects.js <slackUserId> gid1,gid2,gid3
```

---

## Opciones para Automatizar el Cache

### Opción 1: Step Functions (Recomendada)

AWS Step Functions permite workflows de hasta 1 año.

```
[EventBridge Trigger]
    → [Lambda: Get Users]
    → [Map State: For Each User]
        → [Lambda: Search Asana Projects] (15 min timeout)
        → [Lambda: Save to DynamoDB]
```

Pros:
- Sin límite de tiempo
- Reintentos automáticos
- Monitoreo visual

Cons:
- Complejidad adicional
- Costo adicional (mínimo)

### Opción 2: Asana Webhooks

Asana puede notificar cambios via webhooks.

```
[Asana Project Change] → [API Gateway] → [Lambda: Update Cache]
```

Pros:
- Actualizaciones en tiempo real
- Sin búsqueda completa

Cons:
- Requiere configuración en Asana
- Webhook por cada proyecto (complejo)

### Opción 3: EC2 con Cron

Una instancia EC2 pequeña ejecutando el script de cache.

```bash
# Crontab
0 3 * * * /usr/bin/node /app/refresh-all-caches.js
```

Pros:
- Simple de implementar
- Sin límite de tiempo

Cons:
- Costo de EC2 (t3.micro ~$8/mes)
- Otro recurso que mantener

### Opción 4: Lambda con SQS

Dividir el trabajo en mensajes SQS.

```
[Trigger] → [Lambda: List Projects] → [SQS: 1400 messages]
[SQS Consumer Lambda] → Process 1 project → Save if match
```

Pros:
- Escalable
- Sin timeout issues

Cons:
- Muchas invocaciones Lambda
- Complejidad

---

## Archivos Clave

### src/services/asana.js

```javascript
// Función principal de búsqueda
async function getProjectsForUser(userName)

// IMPORTANTE: Paginación en SDK v3.x
offset = projectsResponse._response?.next_page?.offset || null;

// Campo a buscar
const responsableField = customFields.find(
  cf => cf.name === 'Responsable Proyecto'
);
```

### src/services/dynamo.js

```javascript
// Cache functions
async function cacheUserProjects(slackUserId, projects)
async function getCachedUserProjects(slackUserId)  // Returns null if >24h old
```

### src/handlers/slack-events.js

```javascript
// Comando "mis proyectos" usa cache
const cached = await dynamoService.getCachedUserProjects(userId);
if (cached && cached.projects.length > 0) {
  // Mostrar proyectos
} else {
  // Informar que no hay cache
}
```

---

## Variables de Entorno

En Lambda (via template.yaml):
- SLACK_BOT_TOKEN
- SLACK_SIGNING_SECRET
- SLACK_CHANNEL_PMO
- ASANA_PAT
- GROQ_API_KEY
- USERS_TABLE
- UPDATES_TABLE
- CONVERSATIONS_TABLE

En local (.env.local):
- Mismas variables para scripts

---

## Comandos Útiles

```bash
# Desplegar
bash deploy.sh

# Ver logs de Lambda
aws logs tail /aws/lambda/pulse-bot-slack-events-dev --follow

# Escanear usuarios
aws dynamodb scan --table-name pmo-bot-users-dev --region us-east-1

# Ver usuario específico
aws dynamodb get-item --table-name pmo-bot-users-dev \
  --key '{"pk":{"S":"USER#U099D8C69RS"}}' --region us-east-1

# Contar proyectos en Asana
node scripts/test-asana.js --count

# Buscar responsables
node scripts/find-responsables.js
```

---

## Datos de Harold (Usuario de Prueba)

- **Slack ID**: U099D8C69RS
- **Nombre Asana**: Harold Gomez
- **Timezone**: America/Santiago
- **Proyectos**: 8

Proyectos cacheados:
1. Soporte recurrente - Proyecto ESCALONAMIENTO PARA EXTRACCIÓN REMOTA TRENES NS93 DE LÍNEA 1
2. Implementación Escalonamiento para Extracción Remota trenes NS93 de Línea 1
3. Capacitación en plataforma de gestión de proyecto Jira
4. Migración desde GCP hacia AWS - Cliente Amplifica
5. Fin Flow en AWS Automatización, Contenedores y Buenas Prácticas Cloud - Asicom
6. PoC Project Plan IASA
7. Migración de Infraestructura desde Azure hacia AWS
8. Automatización gestión de cuentas AWS

---

## Próximos Pasos Sugeridos

1. **Implementar refresh automático del cache** (elegir una de las 4 opciones)
2. Agregar más usuarios al sistema con sus caches
3. Probar el flujo completo de update request
4. Probar las alertas al canal PMO
5. Implementar tests

---

## Notas Técnicas

### Asana SDK v3.x vs v1.x

El SDK cambió significativamente en v3:
```javascript
// v1.x (NO USAR)
const client = Asana.Client.create();

// v3.x (CORRECTO)
const client = Asana.ApiClient.instance;
client.authentications['token'].accessToken = pat;
const projectsApi = new Asana.ProjectsApi();
```

### Slack Event Subscriptions

URL configurada: `https://1styk31jlc.execute-api.us-east-1.amazonaws.com/dev/slack/events`

Esta URL maneja:
- Events API (messages)
- Interactivity (buttons)
- URL verification challenge

### Rate Limiting

- Asana: 1500 requests/minute (usamos ~72/min)
- Slack: 1 message/second
- Groq: Free tier limits apply

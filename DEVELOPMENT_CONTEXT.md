# Contexto de Desarrollo - Pulse Bot MVP

Este documento contiene el contexto necesario para continuar el desarrollo del bot.

## Estado Actual (2026-02-02)

### Funcionalidades Implementadas

- [x] Onboarding de usuarios (nombre + timezone)
- [x] Comando "ayuda"
- [x] Comando "mis proyectos" (usando cache)
- [x] Comando "PMO-XXX" (busca proyecto por ID)
- [x] Comando "reset" (reinicia perfil)
- [x] Agente de IA con Groq (entiende lenguaje natural)
- [x] Botones interactivos de Slack
- [x] Sistema de cache de proyectos en DynamoDB
- [x] **Cache automático cada hora** (Lambda cache-refresh + EventBridge)
- [x] Flujo de update request (status, blockers, advances)
- [x] Detección de riesgos
- [x] Alertas al canal PMO
- [x] Despliegue automático con SAM CLI

### Funcionalidades Pendientes

- [ ] Webhooks de Asana para actualizaciones en tiempo real (opcional, el cache cada hora es suficiente)
- [ ] Tests unitarios completos
- [ ] Tests de integración
- [ ] Dashboard de monitoreo

---

## Sistema de Cache de Proyectos

### Contexto del Problema

Asana tiene ~1400 proyectos totales. Para encontrar los proyectos de un PM, hay que:
1. Listar todos los proyectos (paginado, 14 páginas de 100)
2. Para cada proyecto, hacer una llamada API para obtener custom_fields
3. Filtrar por campo "Responsable Proyecto"

**Sin optimización:** ~19 minutos (requests secuenciales)

### Solución Implementada: Cache Automático con Optimizaciones

#### Optimización 1: Solo Proyectos Activos

Filtrar proyectos que NO deben incluirse en cache:
- `archived === true` (proyectos archivados)
- `Status === "completed"` (proyectos completados)

**Resultado real:** 1377 proyectos no archivados → 1285 proyectos activos con responsable

#### Optimización 2: Requests Paralelas

En lugar de requests secuenciales (1 a la vez), hacer 20 requests en paralelo.
Asana permite 1500 requests/minuto, usamos ~720/min con 20 paralelas.

**Resultado real:** ~19 minutos → **66 segundos** (probado en AWS Lambda)

#### Resultados del Test en AWS (2026-02-02)

```
Tiempo total: 66 segundos
Proyectos procesados: 1377
Proyectos activos con responsable: 1285
Responsables únicos: 74
Harold Gomez: 8 proyectos cacheados
Memoria usada: 126 MB / 512 MB
```

#### Arquitectura Final

```
[EventBridge: cada 1 hora]
    ↓
[Lambda: cache-refresh] (timeout 120s)
    ↓
[Asana API: requests paralelas]
    ↓
[DynamoDB: actualizar cache de cada usuario]
```

### Cache en DynamoDB

```javascript
// En dynamo.js
cacheUserProjects(slackUserId, projects)  // Guarda proyectos
getCachedUserProjects(slackUserId)        // Lee (válido 24h, con opción allowStale)
```

### Custom Fields de Asana Utilizados

| Campo | Uso |
|-------|-----|
| `Responsable Proyecto` | Identificar PM del proyecto |
| `Status` | Filtrar completados (valores: On track, Off track, On hold, At risk, Completed) |
| `PMO ID` | Búsqueda directa por ID (no usa cache) |

### Usuarios Actuales

| Slack ID | Nombre | Proyectos |
|----------|--------|-----------|
| U099D8C69RS | Harold Gomez | 8 proyectos |

### Agregar Nuevo Usuario

1. Usuario hace onboarding en Slack (automático)
2. Cache se actualiza en el próximo ciclo de EventBridge (cada hora)
3. O manualmente: `node scripts/cache-user-projects.js <slackUserId>`

### Scripts de Administración

```bash
# Refresh manual del cache (ejecuta la misma lógica que Lambda)
node scripts/refresh-all-caches.js

# Buscar proyectos de un responsable específico
node scripts/test-asana.js "Nombre Apellido"

# Ver responsables únicos en Asana
node scripts/find-responsables.js

# Cache manual para un usuario específico
node scripts/cache-user-projects.js <slackUserId> [gid1,gid2,...]
```

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

### src/handlers/cache-refresh.js

```javascript
// Lambda que se ejecuta cada hora via EventBridge
// 1. Obtiene todos los usuarios onboarded
// 2. Busca TODOS los proyectos activos de Asana (paralelo)
// 3. Agrupa por responsable
// 4. Actualiza cache de cada usuario en DynamoDB

exports.handler = async (event) => {
  const users = await dynamoService.getAllOnboardedUsers();
  const allProjects = await asanaService.getAllActiveProjectsWithResponsable();
  const projectsByResponsable = asanaService.groupProjectsByResponsable(allProjects);

  for (const user of users) {
    const userProjects = projectsByResponsable.get(normalizedName);
    await dynamoService.cacheUserProjects(user.slackUserId, userProjects);
  }
};
```

### src/services/asana.js - Funciones Nuevas

```javascript
// Búsqueda paralela optimizada (20 requests simultáneas)
async function getAllActiveProjectsWithResponsable()

// Agrupa proyectos por responsable normalizado
function groupProjectsByResponsable(projects)
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

1. ~~Implementar refresh automático del cache~~ ✅ Implementado y probado (66s en AWS)
2. Agregar más usuarios al sistema (onboarding automático + cache cada hora)
3. Probar el flujo completo de update request (botones de status)
4. Probar las alertas al canal PMO
5. Implementar tests unitarios
6. Monitorear tiempos de ejecución en CloudWatch Dashboard

## Comandos para Monitoreo

```bash
# Ver últimas ejecuciones de cache-refresh
MSYS_NO_PATHCONV=1 aws logs filter-log-events \
  --log-group-name "/aws/lambda/pulse-bot-cache-refresh-dev" \
  --filter-pattern "Completado" \
  --region us-east-1

# Invocar cache-refresh manualmente (no espera respuesta)
aws lambda invoke --function-name pulse-bot-cache-refresh-dev \
  --invocation-type Event \
  --region us-east-1 /dev/null

# Ver estado del EventBridge rule
aws events describe-rule --name pulse-bot-cache-refresh-dev-HourlyRefresh \
  --region us-east-1
```

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

- Asana: 1500 requests/minute (usamos ~720/min con paralelas)
- Slack: 1 message/second
- Groq: Free tier limits apply

### Métricas de Performance (cache-refresh)

| Métrica | Valor |
|---------|-------|
| Tiempo de ejecución | ~66 segundos |
| Proyectos procesados | 1377 |
| Proyectos con responsable | 1285 |
| Responsables únicos | 74 |
| Memoria usada | 126 MB |
| Lambda timeout | 120 segundos |
| Frecuencia | Cada 1 hora |

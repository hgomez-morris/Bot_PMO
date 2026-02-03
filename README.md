# Project Pulse Bot - MVP

Bot de automatización PMO para proyectos de migración cloud hacia AWS.

## Descripción

Project Pulse Bot solicita updates periódicos a Project Managers vía Slack, detecta riesgos automáticamente, y escala al PMO cuando corresponde.

## Stack Tecnológico

- **Runtime**: Node.js 20.x
- **Compute**: AWS Lambda
- **API**: AWS API Gateway HTTP API
- **Database**: AWS DynamoDB
- **Scheduler**: AWS EventBridge
- **AI Agent**: Groq API (Llama 3.1 8B)
- **Integraciones**: Slack API, Asana API v3.x

## Estructura del Proyecto

```
pulse-bot-mvp/
├── src/
│   ├── handlers/           # Lambda handlers
│   │   ├── slack-events.js # Maneja eventos de Slack (mensajes, botones)
│   │   ├── scheduled-pulse.js # Cron job para solicitar updates
│   │   └── cache-refresh.js # Refresca cache de proyectos cada hora
│   ├── services/           # Clientes de APIs externas
│   │   ├── slack.js        # Slack Web API
│   │   ├── asana.js        # Asana API v3.x (con búsqueda paralela)
│   │   ├── dynamo.js       # DynamoDB operations
│   │   └── agent.js        # Groq AI agent
│   └── lib/                # Lógica de negocio
│       ├── messages.js     # Templates de mensajes Slack
│       ├── risk-detector.js # Detección de riesgos
│       └── conversation-state.js # Estado de conversaciones
├── infrastructure/
│   └── template.yaml       # SAM/CloudFormation template
├── scripts/
│   ├── deploy.sh           # Script de despliegue
│   ├── test-asana.js       # Test conexión Asana
│   ├── find-responsables.js # Lista responsables en Asana
│   ├── refresh-all-caches.js # Refresh manual de todos los caches
│   └── cache-user-projects.js # Cachea proyectos de un usuario
├── package.json
├── samconfig.toml          # Configuración SAM CLI
├── .env.local              # Variables de entorno locales
└── README.md
```

## Configuración Inicial

### 1. Variables de Entorno

Crear `.env.local` con:

```bash
# AWS
AWS_REGION=us-east-1

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CHANNEL_PMO=C0XXXXXXXXX

# Asana
ASANA_PAT=...

# Groq (AI Agent)
GROQ_API_KEY=gsk_...

# DynamoDB (para scripts locales)
USERS_TABLE=pmo-bot-users-dev
UPDATES_TABLE=pmo-bot-updates-dev
CONVERSATIONS_TABLE=pmo-bot-conversations-dev
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Desplegar

```bash
bash deploy.sh
```

## Comandos del Bot (Slack)

Los usuarios pueden enviar estos comandos por DM al bot:

| Comando | Descripción |
|---------|-------------|
| `ayuda` | Muestra mensaje de ayuda |
| `mis proyectos` | Lista proyectos asignados (desde cache) |
| `PMO-XXX` | Busca proyecto por ID |
| `reset` | Reinicia el perfil del usuario |

El bot también entiende lenguaje natural gracias al agente de IA.

## Arquitectura de Datos

### DynamoDB Tables

1. **pmo-bot-users-dev** - Usuarios/PMs
   - `pk`: `USER#<slackUserId>`
   - `asanaName`: Nombre como aparece en Asana
   - `timezone`: Zona horaria
   - `onboarded`: boolean
   - `cachedProjects`: Array de proyectos cacheados
   - `projectsCachedAt`: Timestamp del cache

2. **pmo-bot-updates-dev** - Updates de proyectos
   - `pk`: `PROJECT#<projectGid>`
   - `sk`: `UPDATE#<timestamp>`
   - `status`: on_track | at_risk | off_track
   - `advances`: Texto de avances
   - `hasBlockers`: boolean

3. **pmo-bot-conversations-dev** - Estado temporal de conversaciones
   - `pk`: `CONV#<slackUserId>`
   - TTL de 1 hora

### Asana Custom Fields

El bot busca proyectos usando estos campos custom en Asana:
- **"Responsable Proyecto"**: Nombre del PM responsable
- **"PMO ID"**: Identificador único del proyecto (ej: PMO-911)

---

## Sistema de Cache de Proyectos

### Por qué existe el cache

Asana NO permite filtrar proyectos por custom fields. Para encontrar los proyectos de un usuario, hay que:
1. Listar TODOS los proyectos del workspace
2. Obtener los custom_fields de CADA proyecto (1 API call por proyecto)
3. Filtrar por "Responsable Proyecto"

### Cómo funciona el cache

1. **Lambda `cache-refresh`** se ejecuta automáticamente cada hora (EventBridge)
2. Busca proyectos **activos** (excluye archivados y Status="completed")
3. Usa **requests paralelas** (20 simultáneas) para velocidad
4. Guarda en DynamoDB el cache de cada usuario onboarded
5. El comando "mis proyectos" lee del cache, NO de Asana
6. Cache válido por 24 horas (pero se refresca cada hora)

### Optimizaciones implementadas

| Optimización | Impacto |
|--------------|---------|
| Solo proyectos activos | ~1400 → ~300 proyectos |
| Requests paralelas (x20) | ~19 min → ~30-60 seg |

### Custom Fields utilizados

- **"Responsable Proyecto"**: Para asignar proyectos a usuarios
- **"Status"**: Para filtrar (valores: On track, Off track, On hold, At risk, **Completed**)
- **"PMO ID"**: Para búsqueda directa (no usa cache)

### Administración manual del cache

```bash
# Ver usuarios y su cache
aws dynamodb scan --table-name pmo-bot-users-dev --region us-east-1

# Forzar refresh de todos los usuarios
node scripts/refresh-all-caches.js

# Cache manual para un usuario específico
node scripts/cache-user-projects.js <slackUserId>

# Buscar proyectos de un responsable (debug)
node scripts/test-asana.js "Nombre Apellido"
```

---

## Scripts Disponibles

### deploy.sh
Construye y despliega la aplicación a AWS.

```bash
bash deploy.sh
```

### test-asana.js
Prueba la conexión con Asana y busca proyectos.

```bash
# Contar todos los proyectos
node scripts/test-asana.js --count

# Listar responsables únicos
node scripts/test-asana.js --list-responsables

# Buscar proyectos de un responsable
node scripts/test-asana.js "Harold Gomez"
```

### cache-user-projects.js
Cachea proyectos de un usuario en DynamoDB.

```bash
# Usa proyectos hardcodeados de Harold
node scripts/cache-user-projects.js U099D8C69RS

# Especifica GIDs manualmente
node scripts/cache-user-projects.js U099D8C69RS 123456,789012
```

---

## Flujo de Onboarding

1. Usuario envía cualquier mensaje al bot
2. Bot pregunta: "¿Cuál es tu nombre como aparece en Asana?"
3. Usuario responde con su nombre (ej: "Harold Gomez")
4. Bot pregunta zona horaria (botones)
5. Usuario selecciona timezone
6. Bot confirma perfil completado

Después del onboarding, el usuario puede usar comandos.

---

## Flujo de Update Request

1. EventBridge dispara ScheduledPulse (Lunes y Jueves 9am)
2. Lambda obtiene usuarios onboarded
3. Para cada usuario, obtiene sus proyectos (del cache)
4. Envía mensaje con botones de status
5. Usuario selecciona status (On Track / At Risk / Off Track)
6. Bot pregunta si hay bloqueos
7. Usuario responde
8. Bot pide descripción de avances
9. Usuario describe avances
10. Bot guarda update y evalúa riesgos
11. Si hay riesgo, envía alerta al canal PMO

---

## Troubleshooting

### "mis proyectos" no muestra nada
- Verificar que el usuario tiene cache: `aws dynamodb get-item --table-name pmo-bot-users-dev --key '{"pk":{"S":"USER#<slackUserId>"}}'`
- Si no hay cache, esperar al próximo ciclo de cache-refresh (cada hora) o ejecutar manualmente: `node scripts/refresh-all-caches.js`

### Los botones no funcionan
- Verificar que Slack Interactivity URL está configurado: `https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/slack/events`

### Cache no se actualiza
- Verificar que Lambda `cache-refresh` está ejecutándose: revisar CloudWatch Logs
- El cache se actualiza cada hora automáticamente
- Para forzar refresh: `node scripts/refresh-all-caches.js`

### Asana SDK v3.x
- Usar `Asana.ApiClient.instance` y clases separadas (UsersApi, ProjectsApi, etc.)
- Paginación está en `response._response.next_page.offset`

### Ver logs de cache-refresh
```bash
MSYS_NO_PATHCONV=1 aws logs describe-log-streams \
  --log-group-name "/aws/lambda/pulse-bot-cache-refresh-dev" \
  --region us-east-1 --order-by LastEventTime --descending --limit 1
```

---

## Recursos AWS Desplegados

- **Lambda Functions**:
  - `pulse-bot-slack-events-dev` (30s timeout) - Eventos de Slack
  - `pulse-bot-scheduled-pulse-dev` (300s timeout) - Solicita updates Lun/Jue
  - `pulse-bot-cache-refresh-dev` (120s timeout) - Refresca cache cada hora
- **API Gateway**: HTTP API en `/slack/events`
- **DynamoDB Tables**: users, updates, conversations
- **EventBridge Rules**:
  - Lunes y Jueves 13:00 UTC (9am Chile) - Scheduled Pulse
  - Cada hora - Cache Refresh
- **CloudWatch Log Groups**: Retención 30 días

---

## Credenciales y Secrets

Todos los secrets están en AWS CloudFormation Parameters (no en código):
- SlackBotToken
- SlackSigningSecret
- AsanaPAT
- GroqApiKey

Para actualizarlos, modificar `samconfig.toml` y re-desplegar.

---

## Contacto

Proyecto desarrollado para automatización PMO de proyectos de migración cloud.

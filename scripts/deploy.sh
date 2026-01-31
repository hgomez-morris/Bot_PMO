#!/bin/bash
# deploy.sh - Script de despliegue para Unix/Linux/MacOS/Git Bash
# Uso: ./scripts/deploy.sh [dev|prod]

set -e

ENVIRONMENT=${1:-dev}

echo "========================================"
echo "Project Pulse Bot - Deploy Script"
echo "Environment: $ENVIRONMENT"
echo "========================================"

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "Error: Ejecutar desde el directorio raiz del proyecto (pulse-bot-mvp/)"
    exit 1
fi

# Verificar que AWS CLI esta configurado
echo ""
echo "Verificando AWS CLI..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "Error: AWS CLI no configurado. Ejecutar 'aws configure'"
    exit 1
fi
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $AWS_ACCOUNT"

# Verificar que SAM CLI esta instalado
echo ""
echo "Verificando SAM CLI..."
if ! command -v sam &> /dev/null; then
    echo "Error: SAM CLI no instalado."
    echo "Ver: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi
sam --version

# Cargar variables de entorno desde .env.local si existe
if [ -f ".env.local" ]; then
    echo ""
    echo "Cargando variables de .env.local..."
    export $(grep -v '^#' .env.local | xargs)
fi

# Verificar variables requeridas
REQUIRED_VARS=("SLACK_BOT_TOKEN" "SLACK_SIGNING_SECRET" "SLACK_CHANNEL_PMO" "ASANA_PAT")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo ""
    echo "Error: Variables de entorno faltantes:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Crear archivo .env.local con estas variables o exportarlas manualmente."
    exit 1
fi

# Build
echo ""
echo "========================================"
echo "Paso 1: SAM Build"
echo "========================================"

cd infrastructure
sam build --template template.yaml

if [ $? -ne 0 ]; then
    echo "Error en SAM build"
    cd ..
    exit 1
fi

# Deploy
echo ""
echo "========================================"
echo "Paso 2: SAM Deploy"
echo "========================================"

PARAM_OVERRIDES="Environment=$ENVIRONMENT"
PARAM_OVERRIDES="$PARAM_OVERRIDES SlackBotToken=$SLACK_BOT_TOKEN"
PARAM_OVERRIDES="$PARAM_OVERRIDES SlackSigningSecret=$SLACK_SIGNING_SECRET"
PARAM_OVERRIDES="$PARAM_OVERRIDES SlackChannelPMO=$SLACK_CHANNEL_PMO"
PARAM_OVERRIDES="$PARAM_OVERRIDES AsanaPAT=$ASANA_PAT"

sam deploy \
    --config-env $ENVIRONMENT \
    --parameter-overrides "$PARAM_OVERRIDES" \
    --no-fail-on-empty-changeset

if [ $? -ne 0 ]; then
    echo "Error en SAM deploy"
    cd ..
    exit 1
fi

cd ..

# Mostrar outputs
echo ""
echo "========================================"
echo "Deploy completado!"
echo "========================================"

STACK_NAME="pulse-bot-mvp-$ENVIRONMENT"
echo ""
echo "Obteniendo outputs del stack..."

aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table

echo ""
echo "========================================"
echo "IMPORTANTE - Siguiente paso:"
echo "Configurar la URL de Slack Events en tu Slack App:"
SLACK_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='SlackEventsUrl'].OutputValue" \
    --output text)
echo "  $SLACK_URL"
echo "========================================"

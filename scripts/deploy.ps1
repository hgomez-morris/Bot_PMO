# deploy.ps1 - Script de despliegue para Windows PowerShell
# Uso: .\scripts\deploy.ps1 [-Environment dev|prod]

param(
    [string]$Environment = "dev"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project Pulse Bot - Deploy Script" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "package.json")) {
    Write-Host "Error: Ejecutar desde el directorio raiz del proyecto (pulse-bot-mvp/)" -ForegroundColor Red
    exit 1
}

# Verificar que AWS CLI esta configurado
Write-Host "`nVerificando AWS CLI..." -ForegroundColor Yellow
try {
    $awsIdentity = aws sts get-caller-identity | ConvertFrom-Json
    Write-Host "AWS Account: $($awsIdentity.Account)" -ForegroundColor Green
} catch {
    Write-Host "Error: AWS CLI no configurado. Ejecutar 'aws configure'" -ForegroundColor Red
    exit 1
}

# Verificar que SAM CLI esta instalado
Write-Host "`nVerificando SAM CLI..." -ForegroundColor Yellow
try {
    $samVersion = sam --version
    Write-Host "SAM CLI: $samVersion" -ForegroundColor Green
} catch {
    Write-Host "Error: SAM CLI no instalado. Ver: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html" -ForegroundColor Red
    exit 1
}

# Cargar variables de entorno desde .env.local si existe
$envFile = ".env.local"
if (Test-Path $envFile) {
    Write-Host "`nCargando variables de $envFile..." -ForegroundColor Yellow
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Verificar variables requeridas
$requiredVars = @("SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "SLACK_CHANNEL_PMO", "ASANA_PAT")
$missingVars = @()

foreach ($var in $requiredVars) {
    if (-not [Environment]::GetEnvironmentVariable($var, "Process")) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host "`nError: Variables de entorno faltantes:" -ForegroundColor Red
    $missingVars | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "`nCrear archivo .env.local con estas variables o exportarlas manualmente." -ForegroundColor Yellow
    exit 1
}

# Build
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Paso 1: SAM Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location infrastructure
sam build --template template.yaml

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en SAM build" -ForegroundColor Red
    Set-Location ..
    exit 1
}

# Deploy
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Paso 2: SAM Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$slackToken = [Environment]::GetEnvironmentVariable("SLACK_BOT_TOKEN", "Process")
$slackSecret = [Environment]::GetEnvironmentVariable("SLACK_SIGNING_SECRET", "Process")
$slackChannel = [Environment]::GetEnvironmentVariable("SLACK_CHANNEL_PMO", "Process")
$asanaPat = [Environment]::GetEnvironmentVariable("ASANA_PAT", "Process")

$paramOverrides = "Environment=$Environment SlackBotToken=$slackToken SlackSigningSecret=$slackSecret SlackChannelPMO=$slackChannel AsanaPAT=$asanaPat"

sam deploy `
    --config-env $Environment `
    --parameter-overrides $paramOverrides `
    --no-fail-on-empty-changeset

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en SAM deploy" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Set-Location ..

# Mostrar outputs
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deploy completado!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

$stackName = "pulse-bot-mvp-$Environment"
Write-Host "`nObteniendo outputs del stack..." -ForegroundColor Yellow

$outputs = aws cloudformation describe-stacks --stack-name $stackName --query "Stacks[0].Outputs" | ConvertFrom-Json

Write-Host "`nOutputs:" -ForegroundColor Green
foreach ($output in $outputs) {
    Write-Host "  $($output.OutputKey): $($output.OutputValue)" -ForegroundColor White
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "IMPORTANTE - Siguiente paso:" -ForegroundColor Yellow
Write-Host "Configurar la URL de Slack Events en tu Slack App:" -ForegroundColor Yellow
$slackUrl = ($outputs | Where-Object { $_.OutputKey -eq "SlackEventsUrl" }).OutputValue
Write-Host "  $slackUrl" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

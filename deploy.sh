#!/bin/bash
# Deploy script para Project Pulse Bot

SAM="/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd"

cd "$(dirname "$0")"

echo "Building..."
"$SAM" build --template infrastructure/template.yaml

if [ $? -eq 0 ]; then
  echo "Deploying..."
  "$SAM" deploy --config-env dev
else
  echo "Build failed"
  exit 1
fi

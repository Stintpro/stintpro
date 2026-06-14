#!/bin/sh
# Arranque en el VPS / NAS Docker
docker stop  stintpro-logger 2>/dev/null
docker rm    stintpro-logger 2>/dev/null
docker build -t stintpro-logger .
docker run -d \
  --name stintpro-logger \
  --restart always \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  stintpro-logger
echo "Logger arrancado. Logs: docker logs stintpro-logger -f"

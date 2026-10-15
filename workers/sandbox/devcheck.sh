#!/bin/sh
step() { echo "== $1"; }
step "who"; id; nproc; free -m | head -2; df -h / | tail -1
step "dockerd"
for i in $(seq 1 100); do docker version > /dev/null 2>&1 && break; sleep 0.3; done
docker version --format 'server {{.Server.Version}}' || tail -30 /var/log/dockerd.log
step "repo"
rm -rf /tmp/devcheck && mkdir -p /tmp/devcheck/api && cd /tmp/devcheck
printf 'FROM python:3.13-alpine\nRUN pip install --quiet flask\nCMD ["python", "-c", "from flask import Flask\\napp = Flask(__name__)\\n@app.get(\\"/\\")\\ndef hi(): return \\"hello from api\\"\\napp.run(host=\\"0.0.0.0\\", port=8000)"]\n' > api/Dockerfile
cat > compose.yaml <<'YAML'
services:
  api:
    build: ./api
  web:
    image: node:22-alpine
    ports: ["8080:8080"]
    depends_on: [api]
    environment: { GREETING: "${GREETING:-hi}" }
    command: ["node", "-e", "require('http').createServer(async (q, s) => { const r = await fetch('http://api:8000/').then((x) => x.text()).catch((e) => String(e)); s.end('web says: ' + r + ' / ' + process.env.GREETING + ' / secret ' + process.env.APP_SECRET + ' at ' + q.url); }).listen(8080)"]
YAML
git init -q -b main . && git add -A && git -c user.email=c@c -c user.name=c commit -qm stack
commit=$(git rev-parse HEAD)
step "app"
job=$(printf '{"target":"devcheck","project":"devcheck","remote":"/tmp/devcheck","ref":"main","commitId":"%s","env":{"APP_SECRET":"s3cret"},"waitSeconds":180}' "$commit" | base64 -w0)
CHEF_JOB="$job" node /opt/chef/app.mjs
step "local"; curl -sS http://127.0.0.1:8080/local; echo
step "ps"; docker ps --format '{{.Names}} {{.Status}}'
step "all"; docker ps -a --format '{{.Names}} {{.Status}}'
step "api logs"; docker logs --tail 20 devcheck-api-1 2>&1
step "listening"; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | head -20

#!/bin/sh
step() { echo "== $1"; }
step "who"; id; nproc; free -m | head -2; df -h / | tail -1
step "dockerd"
for i in $(seq 1 100); do docker version > /dev/null 2>&1 && break; sleep 0.3; done
docker version --format 'server {{.Server.Version}}' || tail -30 /var/log/dockerd.log
docker info --format 'driver {{.Driver}} cgroup {{.CgroupDriver}}' 2>&1
step "outer https"; curl -sS -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/react
step "hello"; docker run --rm --network=host hello-world 2>&1 | grep -m1 Hello
step "inner npm"; docker run --rm --network=host node:22-alpine npm view react version 2>&1 | tail -2
step "build"
mkdir -p /tmp/devcheck/api && cd /tmp/devcheck
printf 'FROM python:3.13-alpine\nRUN pip install --quiet flask\nCMD ["python", "-c", "from flask import Flask\\napp = Flask(__name__)\\n@app.get(\\"/\\")\\ndef hi(): return \\"hello from api\\"\\napp.run(host=\\"0.0.0.0\\", port=8000)"]\n' > api/Dockerfile
cat > compose.yaml <<'YAML'
services:
  api:
    build: { context: ./api, network: host }
    network_mode: host
  web:
    image: node:22-alpine
    network_mode: host
    extra_hosts: ["api:127.0.0.1"]
    depends_on: [api]
    command: ["node", "-e", "require('http').createServer(async (q, s) => { const r = await fetch('http://api:8000/').then((x) => x.text()).catch((e) => String(e)); s.end('web says: ' + r + ' at ' + q.url); }).listen(8080)"]
YAML
COMPOSE_BAKE=false docker compose up -d --build 2>&1 | tail -8
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8080/ 2>/dev/null && break; sleep 1; done; echo
step "ps"; docker compose ps --format '{{.Service}} {{.State}}'

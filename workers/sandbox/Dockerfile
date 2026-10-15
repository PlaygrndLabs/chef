FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl gnupg iproute2 procps \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin \
 && usermod -aG docker node && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/chef
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY template-package.json /opt/chef/template/package.json
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN cd /opt/chef/template && npm install --no-audit --no-fund && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
COPY lint.mjs /opt/chef/template/lint.mjs
COPY lint /opt/chef/template/lint
COPY runner.mjs checks.mjs app.mjs boot.sh trust.sh ./
RUN mkdir -p /workspace && chown node:node /workspace && git config --system --add safe.directory "*"
CMD ["sh", "/opt/chef/boot.sh"]

FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/chef
COPY package.json runner.mjs checks.mjs ./
RUN npm install --omit=dev --no-audit --no-fund
COPY template-package.json /opt/chef/template/package.json
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN cd /opt/chef/template && npm install --no-audit --no-fund && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
COPY lint.mjs /opt/chef/template/lint.mjs
COPY lint /opt/chef/template/lint
ENV NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt \
    GIT_SSL_CAINFO=/etc/cloudflare/certs/cloudflare-containers-ca.crt \
    SSL_CERT_FILE=/etc/cloudflare/certs/cloudflare-containers-ca.crt
RUN mkdir -p /workspace && chown node:node /workspace
USER node
CMD ["sleep", "infinity"]

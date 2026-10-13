FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*
ARG CRANE_VERSION=v0.20.2
RUN curl -fsSL "https://github.com/google/go-containerregistry/releases/download/${CRANE_VERSION}/go-containerregistry_Linux_x86_64.tar.gz" | tar -xz -C /usr/local/bin crane
RUN corepack enable
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=true WRANGLER_SEND_METRICS=false
WORKDIR /opt/chef
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
CMD ["sleep", "infinity"]

FROM node:22-bookworm-slim
WORKDIR /app
ENV CI=true WRANGLER_SEND_METRICS=false PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 8787
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]

FROM golang:1.26-bookworm AS builder
ARG REVISION=c76dfd4e0edabab9000628b1560ab8ab379eadb8
WORKDIR /src
RUN git init -q . && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
  && git fetch -q --depth 1 origin "${REVISION}" && git checkout -q FETCH_HEAD
RUN CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -ldflags="-s -w -X 'main.Commit=${REVISION}'" -o /out/CLIProxyAPI ./cmd/server/

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /CLIProxyAPI
COPY --from=builder /out/CLIProxyAPI ./CLIProxyAPI
EXPOSE 8317 54545
CMD ["./CLIProxyAPI", "-config", "/state/config.yaml"]

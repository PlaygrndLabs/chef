#!/bin/sh
ca=/etc/cloudflare/certs/cloudflare-containers-ca.crt
for i in $(seq 1 50); do [ -s "$ca" ] && break; sleep 0.2; done
[ -s "$ca" ] || exit 0
cmp -s "$ca" /usr/local/share/ca-certificates/cloudflare-containers.crt && exit 0
cp "$ca" /usr/local/share/ca-certificates/cloudflare-containers.crt && update-ca-certificates > /dev/null 2>&1

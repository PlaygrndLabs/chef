#!/usr/bin/env bash
set -eu
jar=$(mktemp)
curl -sS -m 60 --retry 5 --retry-all-errors --retry-delay 5 -c "$jar" -o /dev/null --data-urlencode "password=$CHEF_PASSWORD" "$1/login"
value=$(awk '$6 == "chef_access" { print $7 }' "$jar")
rm -f "$jar"
if [ -z "$value" ]; then
  echo "could not sign in to $1 with CHEF_PASSWORD" >&2
  exit 1
fi
echo "cookie: chef_access=$value"

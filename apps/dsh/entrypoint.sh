#!/bin/sh
# 起 dsh web：host 必须是具体地址（上游拒绝 wildcard），默认取容器第一个非回环 IPv4。
# DSH_HOME（/dsh）挂在宿主机 apps/dsh/target/.dsh 上：profile 缺失或没装我们的 bundle 时先补上。
set -eu

REGISTRY="${NPM_REGISTRY:-http://host.docker.internal:7677/}"
VERSION="${ZEPHYR_VERSION:-0.2.0-alpha.0}"
PROFILE=/dsh/profiles/web
DSH=/app/node_modules/@deepseek-ai/dsh/lib/bin.js

if [ ! -f "$PROFILE/package.json" ] || ! grep -q '@morlay/better-session' "$PROFILE/package.json"; then
  node "$DSH" --profile web --help > /dev/null
  printf 'registry=%s\n@morlay:registry=%s\n@deepseek-ai:registry=%s\nverify-deps-before-run=false\n' \
    "$REGISTRY" "$REGISTRY" "$REGISTRY" > "$PROFILE/.npmrc"
  node "$DSH" plugin --profile web add \
    "@morlay/dsh-agent-use-profile@$VERSION" \
    "@morlay/better-session@$VERSION" \
    "@morlay/dsh-configurable-sandbox-profile@$VERSION" \
    "@morlay/dsh-session-mode-profile@$VERSION" \
    --ignore-scripts
fi

HOST="${DSH_WEB_HOST:-}"
if [ -z "$HOST" ]; then
  HOST=$(hostname -i 2>/dev/null | awk '{print $1}')
fi
PORT="${DSH_WEB_PORT:-3000}"

exec node "$DSH" --profile web --no-open --host "$HOST" --port "$PORT"

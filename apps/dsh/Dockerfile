# dsh web 容器：装发布线上的 dsh 与 agent-ex 四个 bundle，起 Web UI。
#
#   docker build -t dsh-web --build-arg DEEPSEEK_HARNESS_VERSION=0.2.3-alpha.2 --build-arg ZEPHYR_VERSION=0.2.0-alpha.0 apps/dsh
#
# 宿主机先起本地 registry（它同时代理 npmjs）：docker compose -f tool/npr/compose.yml up -d
FROM node:26-slim

ARG DEEPSEEK_HARNESS_VERSION=0.2.3-alpha.2
ARG ZEPHYR_VERSION=0.2.0-alpha.0
ARG NPM_REGISTRY=http://host.docker.internal:7677/

ENV DSH_HOME=/dsh

RUN npm install -g pnpm@12

WORKDIR /app

RUN printf 'registry=%s\n@morlay:registry=%s\n@deepseek-ai:registry=%s\nverify-deps-before-run=false\n' "$NPM_REGISTRY" "$NPM_REGISTRY" "$NPM_REGISTRY" > .npmrc && printf '{"name":"dsh-web","private":true,"type":"module"}\n' > package.json

# dsh 运行时（发布包；不引入 TS 加载器——上游源码子路径的引用由我们的构建清掉，见设计「npm 发布线」）。
RUN pnpm add "@deepseek-ai/dsh@${DEEPSEEK_HARNESS_VERSION}" --ignore-scripts

# web profile：先让 dsh 生成模板，再把它指到同一个 registry（否则 profile 里的 pnpm 走 npmjs，装不到 @morlay）。
RUN pnpm exec dsh --profile web --help > /dev/null
RUN printf 'registry=%s\n@morlay:registry=%s\n@deepseek-ai:registry=%s\nverify-deps-before-run=false\n' "$NPM_REGISTRY" "$NPM_REGISTRY" "$NPM_REGISTRY" > /dsh/profiles/web/.npmrc
RUN printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n\nallowBuilds:\n  "@deepseek-ai/dsh-subprocess-local": true\n  "@google/genai": true\n  koffi: true\n  node-pty: true\n  protobufjs: true\n' > /dsh/profiles/web/pnpm-workspace.yaml

# agent-ex 四个 bundle（`dsh plugin add` 同时写 dependencies 与 dsh.profile.bundles）。
RUN pnpm exec dsh plugin --profile web add "@morlay/dsh-agent-use-profile@${ZEPHYR_VERSION}" "@morlay/better-session@${ZEPHYR_VERSION}" "@morlay/dsh-configurable-sandbox-profile@${ZEPHYR_VERSION}" "@morlay/dsh-session-mode-profile@${ZEPHYR_VERSION}" --ignore-scripts

COPY entrypoint.sh /usr/local/bin/dsh-web
RUN chmod +x /usr/local/bin/dsh-web

EXPOSE 3000

ENTRYPOINT ["dsh-web"]
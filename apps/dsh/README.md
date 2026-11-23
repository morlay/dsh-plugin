# dsh web（容器）

用发布线上的 `@deepseek-ai/dsh` 起 Web UI，并装上 `agent-ex` 的四个 bundle
（`agent-use` / `better-session` / `configurable-sandbox` / `session-mode`）。

```sh
docker compose -f tool/npr/compose.yml up -d
docker build -t dsh-web --build-arg DEEPSEEK_HARNESS_VERSION=0.2.3-alpha.2 --build-arg ZEPHYR_VERSION=0.2.0-alpha.0 apps/dsh
docker run --rm -p 3000:3000 dsh-web
```

- **registry**：`NPM_REGISTRY`（默认 `http://host.docker.internal:7677/`）——本地 npr 同时提供上游镜像与 `@morlay` 发布包。
- **版本**：`DEEPSEEK_HARNESS_VERSION` / `ZEPHYR_VERSION` 都是 ARG，构建时钉住发布线版本。
- **TS 加载**：上游 cordis 等包在 npm 上发布的是 TS 源码（`./src/*` 出口），Node 默认拒绝 strip `node_modules` 下的 `.ts`；容器用 `tsx` 作为加载器。

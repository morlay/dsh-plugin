# npr：本地模拟 registry（verdaccio）

本机起一个私有 npm registry（`verdaccio/verdaccio:7.1.2`，宿主机 `127.0.0.1:7677`），用来演练发布：
`just publish-npm` 的**默认地址就是它**，真 npmjs 必须显式 `--registry https://registry.npmjs.org/`
（见 [如何验证](../../.agents/standards/how-to-verify.md) 的「交付与发布」）。

```sh
docker compose -f tool/npr/compose.yml up -d       # 起（等健康检查转 healthy）
curl 127.0.0.1:7677/-/ping                        # 活着就回 {}
just publish-npm --dry-run                        # 看包名 / 版本 / dist-tag，不发布
just publish-npm                                  # 真发到本地
just publish-npm --force-republish                # 同名同版本覆盖（unpublish → publish）
docker compose -f tool/npr/compose.yml down -v    # 连存储卷一起清掉
```

- **同名同版本不能原地重发**：verdaccio 对已存在版本回 409（`pnpm publish --force` 也一样，那只跳过客户端
  探测）。要换内容就 `--force-republish`：先 `pnpm unpublish --force` 再 `pnpm publish`，这条**只对本地
  registry 开放**（真 registry 上 unpublish 是真删）。
- **配置分两片**：`verdaccio.base.yaml`（storage / packages / publish / log）与 `verdaccio.uplinks.yaml`
  （上游），容器启动时 `cat` 拼成一份；两片顶层键不许重复。
- **`@morlay/*` 不给 `proxy`**：本地 scope 未发布即 404，不回退到 npmjs；其余名字走上游并缓存。
- 客户端 `@morlay` 的 scope 映射由 `pnpm-workspace.yaml` 的 `registries` 声明（`~/.npmrc` 里同名的
  scope 映射会盖掉 `--registry`，pnpm 12 必须在 workspace 里声明才生效）。

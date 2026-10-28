# @morlay/web-custom-profile

**前端装配层**：把 `@morlay/dsh-client-modules` 插成行，并停用被它取代的上游行（模块表 `modules`、
`client-hmr`、`frontend-static`）。

- **两种形态都要它**：dev（`dshdev web` / `dshdev desktop`）由工具按 `dsh.bundle.patch` 挂在 patch 栈顶；
  打包形态随 app 的 `dsh.profile.bundles` 进 profile——否则页面会落到上游的静态前端产物上，而产物里并没有它。
- **它是纯数据包**（只有 patch / locale / icon，没有源码入口），所以清单不是 tsdown 钩子写回的：
  `build` 脚本就是一行 `pnpm exec dshdev manifest`，走同一份推导——出口按文件存在性补、`engines.dsh`
  按 `DEEPSEEK_HARNESS_VERSION` 写（理由见 [`how-to-write.md`](../../../.agents/standards/how-to-write.md)
  的「包出口」）。手改这两段会在下次 `just build` 被覆盖。
- 前端链路的设计与判据见
  [dsh-client-modules 的设计记录](../../client/dsh-client-modules/.agents/designs/20261013-客户端资源的联邦式预编译.md)。

**插件页不挂长文**：`locale/*.json` 的 `meta.detail` 指向空文件 [`docs/detail.md`](./docs/detail.md)，所以 bundle 详情页的"详细介绍"区是空的；本 README 仍是包门面。

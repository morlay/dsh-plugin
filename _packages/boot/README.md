# @morlay/dsh-app-boot

**我们自己的 app-boot**：按 profile root 装配并启动一次 Cordis 树——替代上游
`@deepseek-ai/dsh-app-boot`（装配）与 `@deepseek-ai/dsh/profile-boot`（`runProfile`），
于是这条链不再依赖 vendor 里那个 private 的 `@deepseek-ai/dsh`（`apps/cli`）。

状态：**设计已定，实现待做**（本目录暂无代码）。施工图见
[设计 自研 app-boot](./.agents/designs/20261015-自研-app-boot（切开-dsh-依赖）.md)：出口、要借的
cordis 部件与服务面、迁移清单、验收标准与第一刀都在那里。

## 用法（落地后）

被 [`@morlay/dsh-desktop-host`](../../desktop/dsh-desktop-host/README.md) 的两个入口使用：

- desktop：[`src/index.ts`](../../desktop/dsh-desktop-host/src/index.ts)（宿主进程）；
- web：[`src/web.ts`](../../desktop/dsh-desktop-host/src/web.ts)（`dshdev --web`）。

两者都只做「解析参数 → 装配 → 接线」，装配的唯一实现在本包：

```ts
const application = bootAppProfile({ profileDir, profile: "desktop", patchFiles, args });
```

# @morlay/dsh-agent-preset

注册自定义模式 `coding` 与 `chat`，各是 `cordis.patch.yml` 里的一行 `@deepseek-ai/dsh-agent-preset`——但
**模式定义里只剩提示词与能力开关**（persona、scope 白名单、`capabilities` 裁剪、read-before-edit 的抵消行）。

功能行与注入通道都不在这里，本包只**引用**它们：

- 功能行清单 → [`@morlay/dsh-agent-toolkit`](../dsh-agent-toolkit/README.md) 的 `rows` 出口；
- 注入通道那套 → [`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md) 的 `rows` 出口
  （整组关进本模式的 `isolate`，通道服务因此不越界）。

配置初始化（llm 路由、搜索后端、沙箱规则值）在 [`@morlay/dsh-profile`](../dsh-profile/README.md)。

设计与取舍（为什么按需列行、persona 分层的机制、通道为什么按模式 `isolate`、读前置策略怎么按模式抵消）见
[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md) 与
[ADR 通道与注入行按模式 isolate 装配](./.agents/adrs/20260922-通道与注入行按模式isolate装配.md)；
验证判据见[本包规范](./.agents/standards/how-to-verify.md)。

## 内容

| 文件                  | 作用                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cordis.patch.yml`    | bundle patch（生成物，真源 [`tool/patch.ts`](./tool/patch.ts)）：`agent-preset-registry` 的 `default: coding`，加 `preset-coding` / `preset-chat` 两行 |
| `tool/patch.ts`       | patch 真源与生成入口：`renderPatch()` 渲染行清单，tsdown 的 `build:done` 钩子（`patchHooks()`）写回 `cordis.patch.yml`——那个文件不要手改               |
| `tool/presets/*.ts`   | 两个模式的装配行清单（工具行、注入行、persona、`relax-intent`），由 `tool/patch.ts` 渲染进对应 preset 行的 `config.plugins`                            |
| `src/relax-intent.ts` | `coding` 专用的一个插件行（出口 `./relax-intent`）：抢在 host 层 `fs-observation-policy` 的 waterfall 前面，对本模式的会话丢弃「先读后改」要求         |

## 每个模式自带一份注入通道

通道（`@morlay/dsh-context-assembler/assembler`）发布进程全局服务，preset 子树里的服务**要么声明 `isolate`、要么被上游
拒绝装载**。我们把它与全部注入行关进同一个
`group("context-channel", …, { isolate: { contextAssembler: true } })`，`coding` / `chat` 各一份：

- 通道的注册表（规则块 / 虚拟 skill / 装配改写）因此只作用在这棵子树里，别的 preset 拿不到它；
- 走这条路的前提是**通道与它的全部消费者同组**（落一个在组外，它的 `inject` 会永远等不到服务，行停在
  waiting 而不报错）——`patch.spec.ts` 把"所有 `@morlay/dsh-context-assembler*` 行都在组内"钉住；
- 判据在真装配里：`just profile` 的隔离探针要求"root realm 读不到通道，且只有我们的模式有它"。

## 装配

`agent-preset-registry` 的 `default` 指向 `coding`；`preset-coding` / `preset-chat` 两行给出各模式的
`config.plugins`。官方那四个 shipped preset（`preset-standard` / `preset-ptc` / `preset-minimal` /
`preset-cordis`）**不动**：它们留在选择器里，选到就是官方原味（官方工具与提示词），默认不是它们。

**三种形态一致**：dev / web / 桌面读的是同一份 patch——上游 0.1.7 起 registry 不扫目录、不收路径，桌面专属的
目录物化（`dsh.configTrees` + app 的 `dsh.desktop.agentPresets`）随之删除。形态沿革见
[ADR preset 改用上游声明式行](./.agents/adrs/20260922-preset改用上游声明式行.md)。

## 生成与升级

`cordis.patch.yml` 由 tsdown 的 `build:done` 钩子在每次 `pnpm build` 时按 `tool/patch.ts` 重写；
文件与真源的一致性、以及每个 preset 行的 `config` 与 `tool/presets/*.ts` 清单的逐项一致，都由
`patch.spec.ts` 守护。

上游升级与适配流程见 [`dsh-plugin-upstream-sync` 技能](../../../.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

## 维护注意

- 清单里每一行的 `name` 都必须能被 **profile 的依赖树**解析：本包 `dependencies` 已声明
  `@morlay/dsh-context-assembler`（组装行，五个能力都在它里面）；引用展开 `@morlay/dsh-reference` 由
  `@morlay/better-session` 装配，不经过 preset。app 的 **preset 相关**依赖只声明 `@morlay/dsh-agent-preset`。
- **dev 模式需要先构建**：`just custom dev` / `just custom desktop` / `just custom bundle` 都先跑
  `preset-build`（`pnpm --filter @morlay/dsh-profile run build` 与
  `pnpm --filter @morlay/dsh-agent-preset run build`）。
- **提示词与规则变化要重启**：profile 在启动时装载。
- **发布产物**：`package.json` 的 `files` 含 `dist` 与 `tool`；模式定义的发布形态就是 `cordis.patch.yml`。

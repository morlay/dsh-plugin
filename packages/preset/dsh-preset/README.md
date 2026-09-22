# @morlay/dsh-preset

个人用 dsh profile bundle：**部署级的 host 配置**。包的实体就是 `cordis.patch.yml`（bundle patch 由
`dsh.bundle.patch` 声明、profile 组合器经该字段解析）。

自定义模式（`coding` / `chat`）不在这里——它们由 [`@morlay/dsh-agent-preset`](../dsh-agent-preset/README.md)
注册。

设计与取舍（patch 层级、沙箱为什么只能在 host、搜索后端的实测证据、office 的处置、按 id 禁用上游行的风险）
见[设计 host 层部署配置](./.agents/designs/20260917-host层部署配置.md)；验证判据见
[本包规范](./.agents/standards/how-to-verify.md)。

## 内容

| 文件               | 作用                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cordis.patch.yml` | bundle patch（生成物，真源 [`tool/patch.ts`](./tool/patch.ts)）：声明个人 `llm-pi-ai` route（ollama 路由的图片上限按 llm-deepseek 默认对齐）、把 `web` 行的 `searchProvider` 切到 `ollama`、按 id 禁用官方 `sandbox` / `fs-sandbox` 两行、插入 `sandbox-local` / `web-search-ollama` 行 |
| `tool/patch.ts`    | patch 真源，同时是生成入口：`renderPatch()` 渲染行清单，tsdown 的 `build:done` 钩子（`patchHooks()`）把它写回 `cordis.patch.yml`——那个文件不要手改                                                                                                                        |

`agent-preset-registry` 的 `default`（默认模式）在 `@morlay/dsh-agent-preset`：它与模式清单是同一个事实。

## 哪些动作属于这一层

判据是**部署事实 vs 模式取舍**：

| 归这里（所有模式理应一致）                                     | 不归这里（某个模式的取舍，由那个模式自己解决）                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| llm 路由与图片上限、搜索后端、进程沙箱（替换 `ctx.fs` / `ctx.sandbox`） | persona 腔调、注入什么内容与怎么送达、要不要「先读后改」策略                                                |
| 理由                                                           | 沙箱替换必须住 root realm（agent 的 ctx 解析不到 preset 里 `isolate` realm 的实现）；搜索后端同 id 注册两次会撞 `WEB_DUPLICATE_PROVIDER` |

**按 id 禁用 host 行是全局动作**：官方那几个 preset 的行一样吃。禁用 `subagent-model-selection-settings` 就是
反例（把官方 `standard` / `ptc` / `cordis` 打成 broken）。"我们不用某能力"的常规实现是**自己的模式行不带那个
开关**；`just profile` 是本层改动的实测判据。

## 生成与升级

`cordis.patch.yml` 由 tsdown 的 `build:done` 钩子在每次 `pnpm build` 时按 `tool/patch.ts` 重写；文件与真源的
一致性、以及本 patch 与上游 base / web-app 层的组合结果（"只多出我们声明的那几条禁用"）由 `patch.spec.ts`
守护。

上游升级与适配流程见 [`dsh-plugin-upstream-sync` 技能](../../../.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

## 维护注意

- 本 bundle patch 插入的每一行，其 `name` 都必须能被 **profile 的依赖树**解析：本包 `dependencies` 已声明
  `@morlay/dsh-sandbox-local` / `@morlay/dsh-web-search-ollama`；app 的依赖只声明本包与
  `@morlay/dsh-agent-preset`。
- **dev 模式需要先构建**：`just custom dev` / `just custom desktop` / `just custom bundle` 都先跑
  `preset-build`（两个包的 build）。
- **规则与配置变化要重启**：profile 在启动时装载，`access` 规则在插件构造时解析。
- **发布产物**：`package.json` 的 `files` 含 `dist` 与 `tool`；本包的发布形态就是 `cordis.patch.yml`。

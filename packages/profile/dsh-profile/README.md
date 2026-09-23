# @morlay/dsh-profile

profile 的**配置初始化层**：按 id 给行配值（`config` 覆盖），或按 id 关掉部署不要的行，**一行都不插**。
包的实体就是 `cordis.patch.yml`（bundle patch 由 `dsh.bundle.patch` 声明、profile 组合器经该字段解析）。

它管三类部署事实：

1. **配置值**：个人 `llm-pi-ai` route、界面语言、默认模型、对话视图、欢迎提示版本、`web` 的 provider 选择、
   搜索后端的 key 引用、沙箱规则的**值**；
2. **关掉部署不要的那几行**：官方 agent preset 整套（`agent-preset-registry` 注册表、四个 shipped preset 行、
   客户端 `ui-agent-preset`）与「先读后改」（`fs-observation-policy`）——本部署的模式只有
   [`@morlay/dsh-session-mode`](../dsh-session-mode/README.md) 那两份数据；
3. **给别人的行配值**：`sandbox-local` 的 `access`、`web-search-ollama` 的 `apiKeyEnv`——行由那两个包自己的
   bundle 插（见下）。

**装配不在这里**：官方 `sandbox` / `fs-sandbox` 两行由
[`@morlay/dsh-sandbox-local`](../../sandbox/dsh-sandbox-local/README.md) 的 patch 禁用并插入替换行，搜索后端的
注册行由 [`@morlay/dsh-web-search-ollama`](../../web/dsh-web-search-ollama/README.md) 的 patch 插入——所以 app 的
`dsh.profile.bundles` 把这两个包排在本包**之前**，本层的 config 覆盖才找得到它们插的行。功能行清单归
[`@morlay/dsh-agent-toolkit`](../dsh-agent-toolkit/README.md)。

**用户层仍压得住本层**：`profiles/<name>/cordis.patch.yml`（settings 面板写的那份）在**每个 bundle 层之后**
应用，所以这里给的是默认值（例如 `locale.preference: zh`），用户改设置照样生效。

设计与取舍（patch 层级、沙箱为什么只能在 host、搜索后端的实测证据、office 的处置、按 id 禁用上游行的风险）
见[设计 host 层部署配置](./.agents/designs/20260917-host层部署配置.md)；验证判据见
[本包规范](./.agents/standards/how-to-verify.md)。

## 内容

| 文件               | 作用                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cordis.patch.yml` | bundle patch（生成物，真源 [`tool/patch.ts`](./tool/patch.ts)）：见上面三类；没有任何 `insert`，禁用的只有上面那几行                               |
| `tool/patch.ts`    | patch 真源，同时是生成入口：`renderPatch()` 渲染行清单，tsdown 的 `build:done` 钩子（`patchHooks()`）把它写回 `cordis.patch.yml`——那个文件不要手改 |

默认模式（`session-mode` 行的 `config.default`）与模式清单在 `@morlay/dsh-session-mode`：它们是同一个事实的两半。

## 哪些动作属于这一层

判据是**部署事实 vs 模式取舍**：

| 归这里（所有模式理应一致）                                                                               | 不归这里（某个模式的取舍，由那个模式自己解决）                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| llm 路由、默认模型、界面语言与对话视图、搜索后端的选择、进程沙箱规则的**值**、关掉官方 agent preset 整套 | persona 腔调、注入什么内容与怎么送达、按模式给哪些工具                         |
| 行本身（谁插、谁禁）归各能力包自己的 bundle                                                              | 沙箱替换必须住 root realm；搜索后端同 id 注册两次会撞 `WEB_DUPLICATE_PROVIDER` |

**按 id 禁用 host 行是全局动作**：官方 agent preset 的注册行也活在这份装配里——这正是"关掉整套"能在这里做的
原因（它们是 host 平面的行，不是某个模式的取舍）。反过来，禁用 `subagent-model-selection-settings` 是反例
（它会把当时仍在的 preset 行打成 broken，见[设计](./.agents/designs/20260917-host层部署配置.md) 里那条实测）。
**关掉一整块机制**与**关掉某个 host 能力**是两件事：前者是"部署不要这个组合"，后者是"我们不用某能力"，
后者应该靠自己的模式声明不带那个开关来实现。
两支真装配探针（`pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts` 与
`…/verify-profile.mts`）是本层改动的实测判据。

## 生成与升级

`cordis.patch.yml` 由 tsdown 的 `build:done` 钩子在每次 `pnpm build` 时按 `tool/patch.ts` 重写；文件与真源的
一致性、以及本 patch 与上游 base / web-app / presets 层的组合结果（官方 agent preset 那几行确实被关掉、
三项默认值确实落在对应行上、"只多出我们声明的那几条禁用"）由 `patch.spec.ts` 守护。

上游升级与适配流程见 [`dsh-plugin-upstream-sync` 技能](../../../.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

## 维护注意

- 本层不声明任何 `@morlay/*` 依赖：它引用的是**行的 id**，行由别的 bundle 提供（那几个包由 app 的
  `dsh.profile.bundles` 与 `dependencies` 声明）。
- **dev 模式需要先构建**：`just custom dev` / `just custom desktop` / `just custom bundle` 都先跑
  `preset-build`（profile 那两个包的 build）。
- **规则与配置变化要重启**：profile 在启动时装载，`access` 规则在插件构造时解析。
- **发布产物**：`package.json` 的 `files` 含 `dist`、`tool` 与 `cordis.patch.yml`。

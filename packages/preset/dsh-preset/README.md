# @morlay/dsh-preset

个人用 dsh profile bundle。包的实体就是 `cordis.patch.yml`（bundle patch 由 `dsh.bundle.patch` 声明、
profile 组合器经该字段解析）：两种模式在这里各是一行 `@deepseek-ai/dsh-agent-preset`。

设计与取舍（禁用官方 roster 的理由、persona / reminder 的提示词分层、生成器机制、patch 层级与放置）见
[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)。

## 内容

| 文件                       | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cordis.patch.yml`         | bundle patch（生成物，真源 [`tool/patch.ts`](./tool/patch.ts)）：注册本包 preset 为默认、声明个人 `llm-pi-ai` route（ollama 路由的图片上限按 llm-deepseek 默认对齐）、覆盖沙箱规则、按 id 禁用官方 `agent-instructions` / `tool-skill` / `sandbox` / `fs-sandbox` / `fs-observation-policy` / `office-to-pdf` / `subagent-model-selection-settings` 行、插入 `sandbox-local` / `context-assembler` / `web-search-ollama` 行、把 `web` 行的 `searchProvider` 切到 `ollama` |
| `tool/patch.ts`            | patch 真源，同时是生成入口：`renderPatch()` 渲染行清单，tsdown 的 `build:done` 钩子（`patchHooks()`）把它写回 `cordis.patch.yml`——那个文件不要手改                                                                                                                                                                                                                                                                                                                         |
| `tool/presets/*.ts`        | 两个模式的装配行清单（工具行、注入行、persona；`chat` 用 `context-scope` 把工具收成三个并关掉全部 instruction），由 `tool/patch.ts` 渲染进对应 preset 行的 `config.plugins`                                                                                                                                                                                                                                                                                                 |

## 装配

装配全在本包的 patch 里，没有目录这一层：`agent-preset-registry` 行的 `default` 指向 `coding`，
`preset-coding` / `preset-chat` 两行（`@deepseek-ai/dsh-agent-preset`）给出各模式的 `config.plugins`。
官方那四个 shipped preset（`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis`）**不动**：
它们留在选择器里，选到就是官方原味（官方工具与提示词，不装我们的注入行），默认不是它们。

**三种形态一致**：dev / web / 桌面读的是同一份 patch——上游 0.1.7 起 registry 不扫目录、不收路径，
桌面专属的目录物化（`dsh.configTrees` + app 的 `dsh.desktop.agentPresets`）随之删除。
决策与代价（含改名对旧会话 preset id 的影响）见
[ADR preset 改用上游声明式行](./.agents/adrs/20260922-preset改用上游声明式行.md)。

## office 相关

两类 office 内容归属不同，本包只管得住其中一个（判断依据、上游证据与上游需求见
[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)）：

- **Office→PDF 转档后端**（`@deepseek-ai/dsh-office-to-pdf`）是官方 web-app bundle 的 profile 行：
  本 bundle 的 `cordis.patch.yml` 按 id 覆盖 `disabled: true`，不启用。副作用是 Sidebar 文档预览的
  Office 标签页（docx / xls(x) / ppt(x)）显示 `unavailable`。
- **office skill**（`@deepseek-ai/dsh-skill-office` 的 docx / pptx / xlsx 三个 skill）不是 profile 行——上游桌面
  宿主命令式装载它，bundle / preset patch 都没有旋钮。桌面形态改由
  [dsh-desktopify](../../desktop/dsh-desktopify/README.md) 的 host 变体
  （[`@morlay/dsh-desktop-host`](../../desktop/dsh-desktop-host/README.md)）决定：该变体既不装载 officeSkills，
  也不再随包它的 assets，因此桌面里不出现这三个 skill。

## 生成与升级

`cordis.patch.yml` 由 tsdown 的 `build:done` 钩子在每次 `pnpm build` 时按 `tool/patch.ts` 重写；
文件与真源的一致性由 `patch.spec.ts` 守护（它比对入库文件与 `renderPatch()`，并逐项比对 preset 行的
`config` 与 `tool/presets/*.ts` 清单）。

> 旧 `tool/generate-presets.ts` 与 `dist/presets` 产物在上游 0.1.7 的声明式 preset 下已无用，随之删除。

上游升级与适配流程见 [`dsh-plugin-upstream-sync` 技能](../../../.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

## 维护注意

- 本 bundle patch 插入的每一行，其 `name` 都必须能被 **profile 的依赖树**解析：本包
  `dependencies` 已声明 `@morlay/dsh-sandbox-local` / `@morlay/dsh-context-assembler` /
  `@morlay/dsh-context-reference` / `@morlay/dsh-context-tool-guidance` / `@morlay/dsh-web-search-ollama`，
  因此 app 的 **preset 相关**依赖只声明
  `@morlay/dsh-preset`；换工作区时要保证这些包在依赖树里可达，否则对应装配行加载失败。清单里的
  `tool-gating` 行同属这一类。
- **提示词与规则变化要重启**：profile 在启动时装载，`system-prompt` 的 section 与 `access`
  规则在插件构造时注册 / 解析。dev 模式重启 `just custom dev` / `just custom desktop`，打包形态
  需重新 `just custom bundle`（patch 随 seed 快照复制）。
- **dev 模式需要先构建**：`just custom dev` / `just custom desktop` / `just custom bundle` 都先跑
  `preset-build`（`pnpm --filter @morlay/dsh-preset run build`）——它重写 `cordis.patch.yml`
  （入库那份就是生成物，改清单后要 build 才生效）。
- **发布产物**：`package.json` 的 `files` 含 `dist` 与 `tool`；模式定义的发布形态就是 `cordis.patch.yml`。
- **按 id 禁用 host 行之前先想官方 preset**：那是全局动作，官方 standard / ptc / cordis 的行也会受影响
  （实例：`subagent-model-selection-settings` 一禁，三个官方 preset 直接 broken）。改完跑 `just roster`
  实测，判据见[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)。

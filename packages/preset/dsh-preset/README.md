# @morlay/dsh-preset

个人用 dsh profile bundle。包的实体是 `cordis.patch.yml` 与构建产出的 `dist/presets/`（bundle patch 由
`dsh.bundle.patch` 声明、profile 组合器经该字段解析）。

设计与取舍（禁用官方 roster 的理由、persona / reminder 的提示词分层、生成器机制、patch 层级与放置）见
[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)。

## 内容

| 文件                       | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cordis.patch.yml`         | bundle patch（生成物，真源 [`tool/patch.ts`](./tool/patch.ts)）：注册本包 preset 为默认、声明个人 `llm-pi-ai` route（ollama 路由的图片上限按 llm-deepseek 默认对齐）、覆盖沙箱规则、按 id 禁用官方 `agent-instructions` / `tool-skill` / `sandbox` / `fs-sandbox` / `fs-observation-policy` / `office-to-pdf` / `subagent-model-selection-settings` 行、插入 `sandbox-local` / `context-assembler` / `web-search-ollama` 行、把 `web` 行的 `searchProvider` 切到 `ollama` |
| `tool/generate-presets.ts` | 生成真源：从上游模块与 `tool/presets/*.ts` 清单渲染出 `dist/presets`，并由 tsdown `build:done` 一并重写 `cordis.patch.yml`（两者都不要手改）                                                                                                                                                                                                                                                                                                                              |
| `dist/presets/`            | 构建产物：`standard` 与 `chat` 两个模式（由各自的清单渲染：工具行、注入行、persona 都在产物里；`chat` 用 `context-scope` 把工具收成三个并关掉全部 instruction）                                                                                                                                                                                                                                                                                                           |

## 装配

`agent-presets` 行把 `roots` 指向本包的 `dist/presets/`（`default: standard`、
`includeShippedRoot: false`、`trust: system`）。该目录随包分发，位置只能在运行期解析，
因此用 `!!js` 表达式从 profile 的 `baseUrl` 起 `createRequire` 解析包路径——表达式本体
与行内容见 `cordis.patch.yml`，机制与理由见
[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)。

**桌面形态**：桌面宿主把 `agent-presets.roots` 固定为 dsh 包内的 `config/agent-presets`
挂载点（`system` root），上面的 `!!js` roots 在桌面 profile 里被覆盖。app 工作区改用
`dsh.desktop.agentPresets` 声明本包的 `dist/presets`，由
[dsh-desktopify](../../desktop/dsh-desktopify/README.md) 在 dev 项目与种子 profile 里把内容
物化到该挂载点。

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

产物由 tsdown 的 `build:done` hook 在每次 `pnpm build` 时生成（同时按 `tool/patch.ts` 重写包根的
`cordis.patch.yml`）。只想看清单渲染出来的产物时手跑脚本（默认输出 `dist/presets`，可传目录）：

```sh
pnpm exec tsx packages/preset/dsh-preset/tool/generate-presets.ts [outDir]
```

该入口会**清空** `outDir`（只接受不存在 / 空 / 只含生成产物的目录，其余直接拒绝），并且**只写产物**——
要落 `cordis.patch.yml` 就跑 `pnpm build`。产物与清单的一致性由 `generated-presets.spec.ts` 守护
（CI 在 `just build` 之后跑 `just test`，所以它在那里真的会比对 `dist/presets`）。

上游升级与适配流程见 [`dsh-plugin-upstream-sync` 技能](../../../.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

## 维护注意

- 本 bundle patch 插入的每一行，其 `name` 都必须能被 **profile 的依赖树**解析：本包
  `dependencies` 已声明 `@morlay/dsh-sandbox-local` / `@morlay/dsh-context-assembler` /
  `@morlay/dsh-context-reference` / `@morlay/dsh-context-tool-guidance` / `@morlay/dsh-web-search-ollama`，
  因此 app 的 **preset 相关**依赖只声明
  `@morlay/dsh-preset`；换工作区时要保证这些包在依赖树里可达，否则对应装配行加载失败。生成器写进 standard
  产物的 `tool-gating` 行同属这一类。
- **提示词与规则变化要重启**：profile 在启动时装载，`system-prompt` 的 section 与 `access`
  规则在插件构造时注册 / 解析。dev 模式重启 `just custom dev` / `just custom desktop`，打包形态
  需重新 `just custom bundle`（patch 随 seed 快照复制）。
- **dev 模式需要先构建**：`just custom dev` / `just custom desktop` / `just custom bundle` 都先跑
  `preset-build`（`pnpm --filter @morlay/dsh-preset run build`）。`dist/presets` 只在 build 时生成，
  源码树里没有，新克隆下直接起 profile 会找不到 preset。
- **发布产物**：`package.json` 的 `files` 必须含 `dist`（preset 在其中）与 `tool`，判据见
  [设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)。

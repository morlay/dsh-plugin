# 本包样式改用上游那套 CSS Modules

状态：已采纳（取代 [ADR-css-in-js样式层与官方token消费](./20260917-css-in-js样式层与官方token消费.md)；
[ADR-设置表单原语搬进client半](./20260923-设置表单原语搬进client半.md) 的"样式改 css-in-js"那半同时作废，控件仍归本包）

背景：本包当初自建 css-in-js（`styled` / `Token` / `dsw` / 生成 token 树），理由是"源码直接加载、零预编译"。
这条理由的三块前提后来都不成立了：

- **上游本来就是 CSS Modules**：官方 `@deepseek-ai/dsh-client-ui-primitives` 每个组件一个 `.module.css`，
  token 直接写 `var(--dsw-*)`。两套样式机制在同一页面上并存——业务借用官方类名（例如统计行"照抄上游
  `StatsPills.module.css` 的 `.root`"）、本包注入 `data-css-*` 与 `cls-*`，两边都要各自兜一遍优先级。
- **本仓库的构建链早就支持 `.module.css`**：devkit 的 `cssInlinePlugins` 把它按 lightningcss 编译并内联成
  "模块执行即注入 `<style>` + 导出 class 映射"，`packages/profile/dsh-session-mode` 的
  `SessionModeSeat.module.css` 一直这么用。
- **预编译本来就是上游客户端的形态**：client 半从来不是"源码直载就完事"——它要过一遍打包（内联库/工厂）。

**决定**

本包的样式全部改成上游那套：

- 每件组件一个 `X.module.css`，组件里 `import css from "./X.module.css"`，token 直接写 `var(--dsw-*)`，
  焦点环照上游 `focus.css` 的表达式；
- 删掉 `src/client/styling/`（`Styling` / `Token` / `styled` / `toolkit` / `css` / `focus`）、`theme.generated.ts`、
  `theme.ts` 与 token 树的生成脚本；
- **能 re-export 就 re-export**：设置表单原语不再 fork（上游那份就是 CSS Modules），本包只留官方没有的
  `SettingsFieldRow`；`Button` / `DisclosureRow` 是本包包装版（官方那份 + 固定修饰）；
- **不能复用就组合上游**：`TagInput`（官方 `Menu` + 裸输入）、`SearchSelect`、`ModelRouteList`、`MultilineField`、
  `IconButton` 各配一个 `.module.css`；
- **补布局原语**：`Stack` / `Row` / `Text` / `Panel`（档位表在 `layout.module.css` + `scales.ts`），
  **业务插件只组合、不写样式**（这条同时写进本层 `packages/client/ui-primitives/.agents/standards/how-to-write.md`）。

工具链缺口一并补上：本包是 `client: false` 的**内联库**，`defineCordisPluginConfig` 之前在那种形态下不挂样式
插件（`.module.css` 直接构建报错「`@tsdown/css` is not installed」）——现在内联库也挂 `cssInlinePlugins`。

**考虑过的选项**

| 选项                                        | 代价                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 保留 css-in-js，只把它做得更像上游          | 两套机制继续并存，页面上的类名/优先级冲突与重复基建都留着                                  |
| 业务层自己写 `.module.css`                  | 与"业务只组合"直接冲突：同一页面上两个消费方各写一份卡片/分组的几何，视觉立刻漂移           |
| **CSS Modules + 上游 re-export + 布局原语（选定）** | 上游升级时本包的 `.module.css` 要跟着对（与 fork 设置表单原语时同样的纪律）；档位表要自己维护 |

**后果**

- 本包与官方同一套技术栈：类名同源（`_name_hash`）、token 同源（`--dsw-*`）、焦点环与控件几何逐帧一致。
- 业务插件的 `.styles.ts` 全部消失，页面只写结构与档位；视觉要改就改 primitives（一处生效）。
- 测试不再断言样式对象（那是 css-in-js 的产物）：样式断言改为"元素带上了哪个类"或直接去掉——布局由页面端到端看。
- dev 与构建两条链都要过一次 lightningcss（`cssInlinePlugins`），与上游客户端一致。

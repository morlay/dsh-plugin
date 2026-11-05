# 如何写

通用部分（接缝、分层、包出口、代码约定）在[根规范](../../../../../.agents/standards/how-to-write.md)；这里只写本包（client 基础面）特有的约束。

## 控件与样式

- **样式一律走上游那套 CSS Modules，本包是唯一写样式的地方**：每件组件一个 `X.module.css`（lightningcss 在构建期编译并内联，实现在 `packages/zephyr/zephyr-app/src/cordis-assets/styles.ts`），token 直接写 `var(--dsw-*)`。**业务插件只组合、不写样式**：不定义 `.module.css`、不写 `.styles.ts`、不写 inline `style`，间距 / 内距 / 文本档位一律从本包的布局原语（`Stack` / `Row` / `Text`）与控件 props 里选。缺档位就在本包补一件或补一档。
  - 判据：同一份视觉在两个页面上长得一样；改视觉只改本包一处。取舍见 [ADR-样式走上游的 CSS Modules](../adrs/20261003-样式改用上游的CSS-Modules.md)。
  - 反例：业务包里 `.styles.ts` / `.module.css` / `style={…}`；业务给上游组件传 `contentClassName` 这类「覆盖用」的类。
- **可复用的控件与它的样式住在本包，业务包只做组合**：官方那套基础组件（`Button` / `Menu` / `Modal` / `Switch` / `SegmentedControl` / 图标 …）由 `src/client/index.ts` 转出。同名项（本包包装版 `Button` / `DisclosureRow`、自造件 `SettingsFieldRow` 等）必须显式再导出：两个星号导出之间的同名项会被判成歧义、两边都不导出。
  - **同一个控件被第二个页面需要时上提到本包**：业务包之间不互相 import 组件。
- **按钮只从 `Button` / `IconButton` / `SeatButton` 三件里选，业务不写裸 `<button>`**：`Button` 是有文字的（危险动作给 `tone="danger"`）；`IconButton` 只有图标（`shape="square"` 是设置面那一档、`shape="circle"` 是对话动作行那一档）；`SeatButton` 是工具行里的「座位」。
- **每个内容组件带一个稳定的 `data-role`**：`button` / `icon-button` / `search-select` / `tag-input` / `multiline-field` / `model-route-list` / `field-row` …——它是「这是个什么控件」的身份，供样式、测试与自动化定位。业务自己的标记另起专名（如 `data-mode-role`）。

## 包面与 client 半

- **本包不是装配行，没有 `./client` 出口**：出口只有 `.`（浏览器组件库）、`./reference`（host 侧引用纯函数）与 `./brand-font.css`。加了 `./client` 就等于告诉装载面「这是一条 client 行」。`apply(ctx)` 由内联它的那一行在 `onInit` 里调。
- **服务与依赖都在 `apply` 之前就位**：本包不在 `apply` 里等依赖（不用 `ctx.inject` / `ctx.plugin` 那套手写装配）——调用方的 `onInit` 已经保证了顺序。
- **运行期挂的服务不能注入，只能按名读**：`apply` 里 `new` 出来的服务（`schemaFormHints`）挂在**根 ctx** 上，消费方用 `schemaFormHintsOf(ctx)` 读。别把它写成契约类令牌 + `inject()`：本包没有 `provide([...])` 清单，`bootstrapApplication` 的 `ProvidersCoverage` 会在**编译期**拒绝，运行期根本走不到。判据是 `src/client/__tests__/hints-injection.spec.ts` 里那条用 `@ts-expect-error` 钉住的用例——错误真消失时它会报「未使用的 expect-error」，所以别用 `as never` 抹掉。
- **client 半的运行时依赖写进 `dependencies`**：React 与上游 client 包在本包的产物里都是裸说明符，由联邦链打成**独立产物**并按 `/_zephyr/@modules/…` 的地址外置（见[设计 客户端资源的联邦式预编译](../../../zephyr-app/.agents/designs/20261013-客户端资源的联邦式预编译.md)）。没有「平台基线替你提供某个包」这回事：漏声明就是解析不到。
- **照抄上游的 token 引用**：官方卡片的 hover 底色、失败文案色这类都直接引用 `var(--dsw-*)`；照抄引用、不换近义 token、也不加 fallback——官方主题哪天定义它们，这里自动跟着生效。

## 测试

- 渲染用例用文件头 `// @vitest-environment happy-dom`，并在 `afterEach(cleanup)`。
- 共享替身放 `src/client/schema-form/testing/`（`FakeScope` / `fakeDescribe` / `discriminatedConfig` / `stubResizeObserver` + `notifyResize`）。
- **不写样式断言**：断言「元素带上了哪个 `data-role` / 哪个类」，几何只在浏览器里看。

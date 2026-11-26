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

## 照抄上游组件时，props 契约也一起 deep import

- **deep import 上游组件（`.../src/client/**/*.tsx`）时，必须连它的 props 契约一起拿**：`PropsRenderSlots` /
  `RenderSlotFn` / `RenderOpts` / `StyleProps` 这些派生类型来自上游，不是我们自己发明的形状。
  - 反例：容器里写 `renderSlot(key, owner, { entryKey }: { entryKey: string })`——多一个必填字段、少一个可选
    字段，都**不会**编译报错（函数参数双变），但渲染器在别处按上游签名给值时，第三参会被静默丢掉，
    症状是 keyed 座位拿不到 key、正文渲染出对象，React 报 `Objects are not valid as a React child`。
- **容器组件与上游座位组件的 props 必须同形**：我们照上游某个座位组件写外壳时，外壳的 props 就按那个
  组件的 `PropsRuntime<'…'> & PropsRenderSlots<…> & InjectFace<…>` 对齐（可以只取用得到的成员，但类型形状
  照抄，不改参数个数与可选性）。
- **判据靠真渲染，不靠类型**：容器/外壳每加一个分支，补一条 `render(<X {...props} />)` 的用例（happy-dom +
  `@testing-library/react`），断言关键节点与 `renderSlot` 的调用形状；纯类型/桩函数测不出参数错位。

## 写座位组件前，先列 props 来源表

组件的每个 prop 必须能追溯到**两类来源之一**，第三类一律不准出现：

| 来源 | 例子 | 备注 |
| --- | --- | --- |
| ① 注册行 `inject` 给的 | `session` / `labels` / `syncPresentation` | 我们的装配行显式提供 |
| ② 渲染器／父在 `renderSlot` 时给的 | `renderSlot` / `SessionProvider` / `useStore` / `t` / `canShow` | 平台注入，不归我们造 |

反例（真发生过三次，同一个错误）：`renderSlot` 自己发明成两参或必填 `entryKey`；正文把 slot 的 opts 当内容塞进 JSX；容器要 `useRightbar` 而注册行只给 `session`。
三者都只在**真跑**时炸（`xxx is not a function` / `Objects are not valid as a React child`），测试与类型都拦不住。

- **写之前**把表列出来（每个 prop 一行：名字 / 谁给 / 缺了会怎样），贴进 PR 或注释；
- **写完**补一条精确相等的断言：允许清单外的 key 出现就红（`__tests__/*props*.spec.dom.tsx` 的写法）；
- 需要 `expanded` 这类「只存在于 store」的状态时，放到有 `useStore` 的那一层（session 座位）用 `useEffect` 报给宿主，别塞进外壳。

## 构造期不能把 `inject` 的值存起来用

`inject(Svc)` 是**登记式**的：字段初始化时拿到的是占位符，`onInit` 之后才换成真实例。所以：

```ts
// ❌ 构造期把占位符存进了构造参数
private readonly binding = new SessionBinding(this.sessions);
// ✅ 传取实例的 thunk，调用时才解析
private readonly binding = new SessionBinding(() => this.sessions);
```

- 症状：运行期 `xxx is not a function` / `undefined is not an object`，而**类型检查与单测全绿**（单测直接 `new` 时注入的是真对象，永远复现不到）；
- 安全形态：thunk（`() => this.svc`）、箭头函数字段（`pin = (a, s) => this.resources.pin(a, s)`）、getter、或在 `onInit` 里再构造；
- 判据：**审代码时对每个「字段初始化里 `new X(this.svc)`」都问一句「这里拿到的是不是占位符」**。

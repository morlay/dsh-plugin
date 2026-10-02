# 如何写

通用部分（接缝、分层、包出口、代码约定）在[根规范](../../../../../.agents/standards/how-to-write.md)；
这里只写本包（client 基础面）特有的约束。

## 控件与样式

- **样式一律走上游那套 CSS Modules，本包是唯一写样式的地方**：每件组件一个 `X.module.css`（lightningcss 在构建期
  编译并内联），token 直接写 `var(--dsw-*)`，焦点环照上游 `focus.css` 的表达式。**业务插件只组合、不写样式**：
  它不定义 `.module.css`、不写 `.styles.ts`、不写 inline `style`，页面里的间距 / 内距 / 文本档位一律从本包的布局
  原语（`Stack` / `Row` / `Text` / `Panel`）与控件 props 里选档。缺档位就**在本包补一件或补一档**，不在业务里就地写。
  - 判据：同一份视觉在两个页面上长得一样；改视觉只改本包一处。技术栈与官方一致（类名同源、token 同源），
    页面上不会同时出现两套样式机制的优先级拉扯。取舍见
    [ADR-本包样式改用上游那套 CSS Modules](../adrs/20261003-样式改用上游的CSS-Modules.md)。
  - 反例：业务包里 `.styles.ts` / `.module.css` / `style={{…}}`；业务给上游组件传 `contentClassName` 这类"覆盖用"
    的类（本包包一层，把那两条类定下来）。
- **可复用的控件与它的样式住在本包，业务包只做组合**：官方那套基础组件（`Button` / `Menu` / `Modal` / `Switch` /
  `SegmentedControl` / `DisclosureRow` / 图标 …）由本包 `export *` 转出，业务包只向本包取控件、**不写控件外观**——
  业务层留的是页面结构布局。同名项（本包包装版 `Button` / `DisclosureRow`、自造件 `SettingsFieldRow`）
  必须显式再导出：两个星号导出之间的同名项会被判成歧义、两边都不导出。
  - 判据：同一份配置在两个页面上长得一样；控件要改外观只改一处。
  - 反例：业务包里就地画一个输入框或按钮（跟官方控件对不齐），或把控件样式写进业务的 `.styles.ts`。
  - **同一个控件被第二个页面需要时上提到本包**：本包是唯一能跨业务包复用的地方（业务包之间不互相 import 组件）。
- **每个内容组件带一个稳定的 `data-role`**：`button` / `icon-button` / `search-select` / `tag-input` /
  `multiline-field` / `model-route-list` / `field-row` …——它是"这是个什么控件"的身份，供样式、测试与自动化定位。
  - 判据：控件能被统一地找到，不靠 class 名或 DOM 层级。
  - 反例：业务自己的标记占用 `data-role`（"哪个角色"这种业务语义另起专名，如 `data-mode-role`）。

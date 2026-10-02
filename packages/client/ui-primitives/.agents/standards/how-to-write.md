# 如何写

通用部分（接缝、分层、包出口、代码约定）在[根规范](../../../../../.agents/standards/how-to-write.md)；
这里只写本包（client 基础面）特有的约束。

## 控件与样式

- **可复用的控件与它的样式住在本包，业务包只做组合**：官方那套基础组件（`Button` / `Menu` / `Modal` / `Switch` /
  `SegmentedControl` / `DisclosureRow` / 图标 …）由本包 `export *` 转出，业务包只向本包取控件、**不写控件外观**——
  业务层留的是页面结构布局。同名项（本包 fork 的 `SettingsForm` / `SettingsValueField` / `SettingsFieldRow` 等）
  必须显式再导出：两个星号导出之间的同名项会被判成歧义、两边都不导出。
  - 判据：同一份配置在两个页面上长得一样；控件要改外观只改一处。
  - 反例：业务包里就地画一个输入框或按钮（跟官方控件对不齐），或把控件样式写进业务的 `.styles.ts`。
  - **同一个控件被第二个页面需要时上提到本包**：本包是唯一能跨业务包复用的地方（业务包之间不互相 import 组件）。
- **每个内容组件带一个稳定的 `data-role`**：`button` / `icon-button` / `search-select` / `tag-input` /
  `multiline-field` / `model-route-list` / `field-row` …——它是"这是个什么控件"的身份，供样式、测试与自动化定位。
  - 判据：控件能被统一地找到，不靠 class 名或 DOM 层级。
  - 反例：业务自己的标记占用 `data-role`（"哪个角色"这种业务语义另起专名，如 `data-mode-role`）。

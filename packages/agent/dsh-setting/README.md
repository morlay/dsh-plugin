# @morlay/dsh-setting

设置文档（`settings.json`）的数据面：读写服务、设置项声明模板与 `settings/*` 端点。
设置机制（schema 注册表与配置文档）在 `@morlay/zephyr-app`；各域自己注册自己的设置项。

## 用法

- 导出：`SettingDeclaration` / `settingRow`（设置项声明与挂载模板）与 `SettingDefault`（`Setting` 服务的默认实现）；`Setting` 契约本身在 `@morlay/zephyr-app`，`./contract` 整份转出那一面。
- 装配函数：`provideSetting()`（`./server`）；`settings/*` 的两端形状（组名、deps 键、方法名）在 `./endpoint`。
- 本包**不装任何 LLM provider**：那是 agent 域的装配。本包也不拥有装配清单。

## 设置视图的三层（schema 默认 → 装配层 → 用户层）

`settings/describe` 的一个命名空间视图有四个数据位，各有各的语义：

| 位 | 是什么 |
| --- | --- |
| `value` | 生效值：schema 默认值 ⊕ **装配层**（行 config）⊕ 用户层（`settings.json`） |
| `base` | 装配层：`configure(实现类, patch)` 给的那一份（`@Setting` 的 `settingRow` 在 `onInit` 注册 schema 时一并交出） |
| `user` | 只有用户自己写过的层；没写过就没有这个键 |
| `secrets` | schema 声明为 `role('secret')` 的每个位置与「有没有值」；三层里的密钥值都已被抹掉 |

`base` 这一层不能省：模型页按 `value` 的 `settingsPath` 判「这个 provider 配没配」，缺了它，装配里配好的
provider（如 `llm-pi-ai` 的路由）在设置页永远是「未配置」、只能从「添加」里重配一份。

密钥**只写不读**：`value` / `base` / `user` 都按活的 schemastery 走一遍 `redactSecrets`
（上游 `@deepseek-ai/dsh-settings` 的实现），读回的树里没有密钥值，UI 靠 `secrets` 渲染「已设置 / 未设置」。
写回走 `settings/mutate` 的路径操作（在内存的完整文档上改），不会被抹掉的空值覆盖。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
为什么视图要带装配层与密钥脱敏，见[设置视图的 base 层](../.agents/designs/20261122-设置视图带装配层与密钥脱敏.md)。

# @morlay/dsh-setting

设置文档（`settings.json`）的数据面：读写服务、设置项声明模板与 `settings/*` 端点。
设置机制（schema 注册表与配置文档）在 `@morlay/zephyr-app`；各域自己注册自己的设置项。

## 用法

- 导出：`SettingDeclaration` / `settingRow`（设置项声明与挂载模板）与 `SettingDefault`（`Setting` 服务的默认实现）；`Setting` 契约本身在 `@morlay/zephyr-app`，`./contract` 整份转出那一面。
- 装配函数：`provideSetting()`（`./server`）；`settings/*` 的两端形状（组名、deps 键、方法名）在 `./endpoint`。
- 本包**不装任何 LLM provider**：那是 agent 域的装配。本包也不拥有装配清单。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

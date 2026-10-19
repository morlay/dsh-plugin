# @morlay/dsh-command

命令注册表与斜杠命令的两半：谁能登记一条命令、模型与用户怎么触发它，各有各的面。

## 用法

- 导出：`CommandRegistry` / `CommandCatalog` / `CommandRunner` / `CommandContribution` 与 `@Command()` 装饰器；wire 契约在 `@morlay/dsh-command/endpoint`。
- 装配：`CommandModule`；宿主半在 `@morlay/dsh-command/server`，浏览器半在 `@morlay/dsh-command/ui`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

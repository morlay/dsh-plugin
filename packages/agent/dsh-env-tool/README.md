# @morlay/dsh-env-tool

四个宿主侧工具行：bash、文件读写、文件检索、工作目录，工具定义在上游插件里。

## 用法

- 导出：无契约（契约面是 `@morlay/dsh-agent` 的 `Tools`）。
- 装配：`EnvToolModule`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

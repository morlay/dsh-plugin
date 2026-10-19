# @morlay/dsh-telemetry

OpenTelemetry 聚合面与会话遥测后端：把会话与工具调用变成可导出的 trace。

## 用法

- 导出：`Otel` / `SessionTelemetry` 契约与默认实现。
- 装配：`TelemetryModule`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

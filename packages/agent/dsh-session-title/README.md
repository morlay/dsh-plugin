# @morlay/dsh-session-title

会话标题：从首条提示或 LLM 生成一句话标题，让侧栏与列表有可读名字。

## 用法

- 导出：`SessionTitle` 契约与 `SessionTitleDefault`。
- 装配：`SessionTitleModule`（标题服务）与 `SessionTitleLlmModule`（首条提示的 LLM 实现）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

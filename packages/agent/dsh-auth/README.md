# @morlay/dsh-auth

只有 API Key 的凭证与授权两行：给 LLM 与工具调用一个可判定的凭据来源，不接平台账号。

## 用法

- 导出：`Credentials` / `Authorization` 契约与 `CredentialsDefault` / `AuthorizationDefault`。
- 装配函数：`provideAuth()`（`./server`）。本包不拥有装配清单。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

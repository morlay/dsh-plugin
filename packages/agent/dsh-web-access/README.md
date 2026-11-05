# @morlay/dsh-web-access

联网访问：搜索与抓取两个后端、一个 `Web` 契约，以及给模型的 web 工具行。

## 用法

- 导出：`Web` 契约与 `WebDefault`，两个后端行 `WebSearchDeepseek` / `WebFetchHttp`。
- 装配：`WebModule`；工具行 `ToolWeb` 从包根拿（`./server` 子出口已删——它零消费方）。

## 事实

- `WebFetchHttp` 是上游 `@deepseek-ai/dsh-web-fetch-http` 的一行适配：抓取的行为（协议/长度/凭据检查、同源重定向、字节与字符上限、超时）全在上游，本包不叠加策略。上游 0.2.2 的 fetch 不做地址策略，所以抓内网地址在这里表现为连接失败——这是上游的现状，不是本包的取舍。
- 行不走上游的 schemastery 解析，所以 `mount` 的 config 显式给同一组默认值（见 `web-fetch-http.service.ts`）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

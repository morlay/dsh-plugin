后台任务注册表：长跑动作在此登记、查询与取消，工具调用之外也有统一出口。

## 用法

- 契约（`./contract`）：`JobRegistry`（上游服务名 `jobs`，只活在 **Node 树**里）与浏览器侧的 `Jobs`
  （同样叫 `jobs`，但只存在于浏览器树；两者不会出现在同一个 ctx 上）。
- 宿主半（`./server`）：`provideJob()`——注册表行 + `job_list` / `job_output` / `job_kill` 三条工具行 +
  `remote.job` 的宿主面（`JobEndpointDefault` 是 `./endpoint` 那份契约的实现）。
- 浏览器半（`./ui`）：`provideJobUi()`——三行。
  - `JobEndpointClient`：`./endpoint` 契约的客户端形态，自己 `$mount` `job` 那组 remote；
  - `JobsClient`：`ctx.jobs` 数据面（本会话可见的 roster、按 job 的观察流、人工 kill；上游
    `@deepseek-ai/dsh-api-job-controller/client`），注入上一行只为顺序；
  - `JobListSlots`：会话面板里的后台任务一节（`conversation.session.panel.section` 的 `background-jobs`：状态、耗时、
    进度、展开后的实时输出面板、两次点击的 kill；上游 `@deepseek-ai/dsh-client-ui-jobs/client`）。

  **两半都要装**：只装宿主半时模型照样能起后台任务，界面上却没有入口、也没法 kill（跑着的东西看不见）。

- `provideJobIdleGuard()`：job 域忙不忙（开发态换树按它按住；开着的任务会让换树等）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
上游 client 半的装配口径见[上游基础装配](../.agents/designs/20261113-上游基础装配.md)。

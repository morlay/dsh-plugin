# 如何写（agent 能力层）

通用部分（接缝、分层、包出口、命名）在[根规范](../../../../.agents/standards/how-to-write.md)与
[`ui-module.md`](../../../../.agents/standards/ui-module.md)；这里只写 `packages/agent/*` 特有的约束。

## 装一条上游行：`deps` 按上游**代码**核，不按 `static inject`

`mount(ctx, config, deps)` 的 `deps` 键是**上游服务名**（`sessions` / `sessionQuery` / `connection` …），不给容器起别名。上游普遍会读没写进 `static inject` 的服务——`ctx.connection.fetch`、`ctx.invocation` 这类——**这类必须在 `deps` 里显式给**。

漏给不会在装配期失败：上游第一次读它时报 `Cannot read properties of undefined (reading 'fetch')`，失败点离装配点很远，还会被业务层包成另一个错误。装一条新行时按上游的**实现**核一遍 `deps`，不只信 `static inject`。

实例与写法：`packages/agent/dsh-conversation/src/server/api-session.provide.ts` 的 `depConnection`（注释写明上游在哪读它）。

## 行的三种形态，按「有没有第二个消费方」选

| 形态                         | 何时用                                         | 代价                                                   |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `fromCordis(契约, 上游插件)` | 标准形态：有消费方按能力注入                   | 契约要覆盖上游全部公开成员（否则上游读到 `undefined`） |
| `fromCordis(上游插件)`       | 只装一行、没人按能力注入它（令牌从插件名派生） | 跨包消费方失去「契约即令牌」的约束                     |
| `fromCordis(契约)`           | 本仓自己实现，没有上游可装                     | 契约方法全要自己写                                     |

判据只有一条：**新增契约的唯一理由是「有消费方要按能力注入」或「有第二个实现要可替换」**。给单行包造空契约只是多一次跳转。

## 契约成员逐条投影，并带覆盖守卫

`abstract class` 逐条声明，成员类型直接取上游实例（`abstract x(): Upstream["x"]`），文件末尾一行
`AssertCovered<上游实例, 本契约>`——它把「上游有、契约没列」变成编译错误。上游同名符号的处置：

1. 本地端口优先占名字（`TokenMeter` 是本地端口，上游同名类只在 `./server` 面出）；
2. 上游的值类型按「结果 / 输入」语义改名（`SandboxPolicy.resolve()` 的结果叫 `ResolvedSandboxPolicy`），不用 `Upstream` 前缀这类实现词；
3. 上游实现类只从 `./server` 出，不进 `./contract`。

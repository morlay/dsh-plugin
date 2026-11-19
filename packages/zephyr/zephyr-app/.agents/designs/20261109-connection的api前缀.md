# connection 的 /api 前缀：HTTP 面归我们，wire 载体归上游

状态：已实现——`/api` 前缀（含信任围栏）由 `ConnectionDefault` 挂；`/api` 的 rpc 拦截与 `/api/remote.mux` 的 upgrade 由上游 `api-gateway` 注册。
范围：`packages/zephyr/zephyr-app/src/connection/connection.service.ts`（`ConnectionDefault`）与它注册的 `/api` 前缀；准入一档的放行（`admitLocalPeer`）。
非目标：认证的实现（上游 `browser-auth`）、`connection` 服务本身的语义、前端 transport（仍是 `muxTransport`）。
关联：[设计 宿主装配面与 client-modules](./20261022-client-modules-重写.md)、[ADR-不fork上游前端组件只做插槽扩展](../../../../../.agents/adrs/20261001-不fork上游前端组件只做插槽扩展.md)。

## 一、决定

| #   | 议题               | 决定                                                                                                          | 一句话理由                                                                                                                           |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | wire 载体谁实现    | 上游 `api-gateway` 一份：帧协议、RPC 分派、事件流、事件答复、附件、错误 details                               | 自研载体每遇一个「不是 Remote 方法」的端点就得补一次（`$events` / `$events/result`），补漏只有联调能发现                             |
| 2   | `webServer` 面     | **交给上游**：`ApiGatewayDefault.mount` 的 deps 带 `connection` / `webServer`                                 | 上游据此在 `ctx.inject(['connection','webServer'], …)` 里注册 rpc 拦截与 `/api/remote.mux` 的 upgrade                                |
| 3   | `/api` 前缀谁挂    | `ConnectionDefault` 自己注册 `register({ kind: "prefix", path: "/api" })`，把请求交给上游的共享分派器         | 上游的 `createSharedFetchHandler` 只组合路由，不挂 HTTP；前缀与准入是载体的事                                                        |
| 4   | 准入（本机免认证） | shadow 上游实例的 `admit`：只把 `{ rejection: 401 }` 换成 `{ peer: browserPeer }`；`403` 与已认证凭据原样返回 | 403 是 Host / Origin 信任检查（挡的是别的站点借道本机端口），不是认证                                                                |
| 5   | 信任围栏的位置     | 在 `/api` 前缀的 handler 里、**拿 node 的 `req`** 调 `connection.requestRejection`                            | 上游的共享分派器不做准入；而 `Request` 构造会丢掉 `origin` / `sec-*` / `host`（forbidden header），围栏挪进 fetch 桥就永远看不见它们 |
| 6   | 时机               | 用 `ctx.inject(["connection"], cb)`，在里面现取一次实例                                                       | 前缀与围栏都要**运行期那一个** `connection`；对已存在的服务是立即回调，对稍后出现的会等到出现                                        |
| 7   | 请求体             | 整份缓冲后再交给 `connection.fetch`                                                                           | 上游登记的 fetch 路由与 rpc 分派都是 `buffered` 形态                                                                                 |
| 8   | `generation`       | 把上游实例的 `generation` 收敛成**总是 observable**（未连接时给兜底值）                                       | 上游 `ClientRemoteService` 的宿主面无条件读它的快照，未连接时一渲染就炸                                                              |

## 二、现状事实

- **前缀常量**：`API_PREFIX = "/api"`，与上游 `createSharedFetchHandler(API_PATH)` 的 `API_PATH` 同值。
- **`mountFetchRoutes(face, trust)`**：注册一条 prefix；handler 先 `trust.requestRejection(req)`（`401` → `401`、`403` → `403`，两者都只写状态码与一行文本、不进分派），再 `bridgeFetch`：node 请求 → `Request`（`duplex: "half"`，体已缓冲）→ `face.fetch(request, OWNER_PEER)` → 写回状态与头。单条失败只记 error 并回 500，不把宿主带走。
- **`admitLocalPeer(instance, logger)`**：`Object.defineProperty` 在实例上 shadow `admit`（原型方法）。`admitConnection`（upgrade 准入）与 `requestRejection` 都经 `this.admit`，所以 shadow 一个成员就够；上游缺 `admit` / `browserPeer` 时留一条 warn。
- **`observeRpc`**：把实例上的 `rpc` 换成带日志的包装（`handle` 原样、`intercept` 打一行）——`rpc` 是原型 getter，每次读都给新对象，所以定义自有属性。
- **上行 upgrade**：`/api/remote.mux` 由上游 `RemoteStreamMuxServer` 接管（`admitConnection` 准入 → `ws` 握手 → `open/item/end/error/cancel` 帧）。
- **`OWNER_PEER`**：本机宿主自己的界面通道（`principal: { kind: "owner" }`），HTTP 面的请求都按这份身份进分派。
- **`Credentials` 只转交**：`mount(ctx, undefined, { credentials })`；认证本身由上游实现，本包不定义认证契约。

## 三、模块边界与接口

| 模块                | 拥有（职责与不变量）                                                                                           | 不拥有（明确排除）                                        | 依赖方向                                                                                   | 接缝 / 适配器                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `ConnectionDefault` | `/api` 前缀的注册与撤销、信任围栏、HTTP ↔ 共享分派器的转交、`admit` 的 401 放行、`generation` 兜底、`rpc` 观测 | 认证实现；帧协议与 rpc 分派；`/api/remote.mux` 的 upgrade | ← 上游 `@deepseek-ai/dsh-client-connection`、`Credentials`、`WebServer`、`Logger`          | `fromCordis(Connection, ConnectionPlugin)` 适配行    |
| `ApiGatewayDefault` | 把 `connection` / `webServer` / `typert` 交给上游（wire 载体的装配面）                                         | 准入判定（归 `connection` 那一行）                        | ← 上游 `@deepseek-ai/dsh-api-gateway`、`Connection`、`WebServer`、`Typert`、`RemoteAccess` | `fromCordis(TypertGateway, ApiGatewayPlugin)` 适配行 |
| `bridgeFetch`       | 请求体缓冲、URL 还原、响应写回                                                                                 | 路由匹配与准入（归上游分派器与 `requestRejection`）       | 无                                                                                         | 纯流程，可单测                                       |

**接口**：`ConnectionDefault` 对外只是 `Connection` 契约；路由记录出现在 `WebServer.routesOf()` 里——`kind: "prefix"`、`path: "/api"` 一条（归我们），`kind: "upgrade"`、`path: "/api/remote.mux"` 一条（归上游）。

不变量：`/api` 只有一条 prefix、`/api/remote.mux` 只有一条 upgrade；`connection` 未出现时不注册；`onDispose` 撤销自己那条。

## 四、行为与边界

- 正常：`/api/<端点>` 命中上游 exact 路由 → 200；命中 rpc 拦截（`api-gateway` 认领的端点）→ 200 的 `server-response`；两者都没有 → 上游回 404。
- 准入：无凭据的请求（本机页面 `fetch` / `WebSocket`）按 owner peer 进分派；Host 不是本机、或 `Origin` / `sec-fetch-site` 表明跨站 → 403。
- 错误：分派抛错 → 记 `[connection] /api 的 fetch 分派失败`，未发头时才回 500。
- 取消：`onDispose` 调 `disposeApi`（`webServer.register` 的撤销函数）。
- 并发：无共享可变状态；`OWNER_PEER` 是模块级常量。

## 五、验收判据

| #   | 判据（Done when）                                                  | 测试面（接缝）        | 证据（命令 / 用例名）                                                                                    |
| --- | ------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | 交给上游之后 `/api/remote.mux` 的 upgrade 只有上游那一条           | `WebServer` 的路由表  | `api-gateway.spec.ts`「交回 connection / webServer 之后，upgrade 只有上游那一条 /api/remote.mux」        |
| 2   | `admit` 的 401 档放行、403 与已认证凭据原样返回                    | `admit`（假上游实例） | `connection-admit.spec.ts`（4 条：401 / 403 / 已有 peer / 缺面 warn）                                    |
| 3   | `/api` 的 HTTP 面先过 Host / Origin 信任围栏（跨站 Origin 回 403） | 真 HTTP + `WebServer` | `api-gateway.spec.ts`「`/api` 的 HTTP 请求先过 Host / Origin 信任检查（跨站 Origin 回 403）」            |
| 4   | 装配面不再装自研 mux 时，dev 的换树行照样装得上（传输层判据缺席）  | `DevHmr` 契约         | `zephyr-dev` 的 `server-hmr.spec.ts`「装配面不装 MuxServer 时换树行照样装得上，按各域 IdleGuard 判空闲」 |

## 六、取舍

- 否掉「继续自己实现 wire 载体」：上游那份已经覆盖帧协议、事件流、答复与附件，自研那份每遇到一个非 Remote 端点就要补一次，且补漏只有联调能发现。
- 否掉「给 `WebServer` 加别名但只交一半」：上游的 upgrade 与 rpc 拦截是同一个 `ctx.inject(['connection','webServer'], …)` 里的两条贡献，交面就是全交；同一路径的第二条 upgrade 靠装配面不装自研 mux 来保证。
- 否掉「在 fetch 桥里做准入」：`Request` 构造过滤 forbidden header（`origin` / `sec-*` / `host`），围栏只能落在 node 的 `req` 上。

## 七、不做与已知债

- 不做「删掉自研 `MuxServer` 的源码」：`MuxServer` / `provideMuxServer` / `dispatchWire` 仍在包内，装配面不再装它们。
- 不实现认证：`Credentials` 只转交给上游；缺认证那一档由 `admit` 的 shadow 放行。
- 前端 transport 仍是本仓的 `muxTransport`：帧形状与上游 `stream-protocol.ts` 一致（`open/item/end/error/cancel`），`$events` 能收到 `ready`。

## 八、开放问题

- `generation` 兜底值是 `{ id: 0, host: undefined }`：上游若给 id 加了语义（排序 / 失效），这个 0 的含义要重新对一次。
- `admit` 的 shadow 依赖上游「`admitConnection` / `requestRejection` 都经 `this.admit`」这一实现事实；上游若改成各自直判，放行就只覆盖一部分入口。

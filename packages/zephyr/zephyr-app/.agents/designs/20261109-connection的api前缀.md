# connection 的 /api 前缀：不把 webServer 交给上游

状态：已实现——上游 `connection.fetch` 表里的 HTTP 路由由我们自己挂一条 `prefix /api` 转交，`webServer` 面不交给上游。
范围：`packages/zephyr/zephyr-app/src/connection/connection.service.ts`（`ConnectionDefault`）与它注册的 `/api` 前缀。
非目标：认证的实现（上游 `browser-auth`）、`connection` 服务本身的语义、`/api/remote.mux` 的 upgrade（归 `MuxServer`）。
关联：[设计 宿主装配面与 client-modules](./20261022-client-modules-重写.md)、[ADR-不fork上游前端组件只做插槽扩展](../../../../../.agents/adrs/20261001-不fork上游前端组件只做插槽扩展.md)。

## 一、决定

| #   | 议题           | 决定                                                                                                     | 一句话理由                                                                                                    |
| --- | -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `/api` 谁挂    | 由 `ConnectionDefault` 自己注册 `register({ kind: "prefix", path: "/api" })`，把请求交给上游的共享分派器 | 上游那张 `connection.fetch` 表自己不会变成 HTTP 路由                                                          |
| 2   | `webServer` 面 | **不**以别名形式交给上游                                                                                 | 交了之后上游会多注册 `/api/<channel>` 的 rpc 分派与第二条 `/api/remote.mux` 的 upgrade，把本装配的 mux 链打断 |
| 3   | 时机           | 用 `ctx.inject(["connection"], cb)`，不用 `mount` 之后立刻 `ctx.get`                                     | 上游在 `apply` 里 `new` 实例时才发布 `connection`，`mount` 返回那一刻它是 `undefined`                         |
| 4   | 请求体         | 整份缓冲后再交给 `connection.fetch`                                                                      | 上游登记的 fetch 路由都是 `buffered` 形态                                                                     |
| 5   | `generation`   | 把上游实例的 `generation` 收敛成**总是 observable**（未连接时给兜底值）                                  | 上游 `ClientRemoteService` 的宿主面无条件读它的快照，未连接时一渲染就炸                                       |

## 二、现状事实

- **前缀常量**：`API_PREFIX = "/api"`，与上游 `createSharedFetchHandler(API_PATH)` 的 `API_PATH` 同值（`src/connection/connection.service.ts`）。
- **`mountFetchRoutes(face)`** 注册一条 prefix，handler 里 `bridgeFetch`：node 请求 → `Request`（`duplex: "half"`，体已缓冲）→ `face.fetch(request, OWNER_PEER)` → 写回状态与头。单条失败只记 error 并回 500，不把宿主带走。
- **分派口径**与上游一致：先 `connection.fetch` 注册的 exact 路由，其次共享通道的 rpc 拦截器（本装配没装），都没有时上游自己回 404。
- **`observeRpc`**：把实例上的 `rpc` 换成带日志的包装（`handle` 原样、`intercept` 打一行）——`rpc` 是原型 getter，每次读都给新对象，所以定义自有属性。
- **`OWNER_PEER`**：本机宿主自己的界面通道（`principal: { kind: "owner" }`），与 `MuxServer` 的 peer 同一口径。
- **`Credentials` 只转交**：`mount(ctx, undefined, { credentials })`；认证本身由上游实现，本包不定义认证契约。

## 三、模块边界与接口

| 模块                | 拥有（职责与不变量）                                                                     | 不拥有（明确排除）                                                                             | 依赖方向                                                                          | 接缝 / 适配器                                     |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ConnectionDefault` | `/api` 前缀的注册与撤销、HTTP ↔ `connection.fetch` 的转交、`generation` 兜底、`rpc` 观测 | 认证实现；`/api/<channel>` 的 rpc 分派；`/api/remote.mux` 的 upgrade；`webServer` 面的对外形状 | ← 上游 `@deepseek-ai/dsh-client-connection`、`Credentials`、`WebServer`、`Logger` | `fromCordis(Connection, ConnectionPlugin)` 适配行 |
| `bridgeFetch`       | 请求体缓冲、URL 还原、响应写回                                                           | 路由匹配（归上游分派器）                                                                       | 无                                                                                | 纯流程，可单测                                    |

**接口**：`ConnectionDefault` 对外只是 `Connection` 契约；`/api` 的路由记录出现在 `WebServer.routesOf()` 里（`kind: "prefix"`、`path: "/api"`）。
不变量：`/api` 只有一条 prefix；`connection` 未出现时不注册；`onDispose` 撤销自己那条。

## 四、行为与边界

- 正常：`/api/<名字>` 命中上游 exact 路由 → 200；上游没注册的路径 → 上游自己回 404。
- 错误：分派抛错 → 记 `[connection] /api 的 fetch 分派失败`，未发头时才回 500。
- 取消：`onDispose` 调 `disposeApi`（`webServer.register` 的撤销函数）。
- 顺序：`ctx.inject(["connection"], …)` 对「已存在」立即回调、对「稍后出现」等到出现。
- 并发：无共享可变状态；`OWNER_PEER` 是模块级常量。

## 五、验收判据

| #   | 判据（Done when）                                                             | 测试面（接缝）       | 证据（命令 / 用例名）                                                                                         |
| --- | ----------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `webServer` 面不被交给上游：`routesOf()` 里 `/api` 的 upgrade 只有 mux 那一条 | `WebServer` 的路由表 | `src/__tests__/api-gateway.spec.ts`「api-gateway 注册的 /api 升级出现在 routesOf()」                          |
| 2   | `/api` 的 prefix 注册与转交                                                   | `ConnectionDefault`  | **没有自动化用例**——人工 `curl http://127.0.0.1:<port>/api/present.host` 期望 200、参数错时 400（见开放问题） |

## 六、取舍

- 否掉「给 `WebServer` 契约加 `@Injectable({ name: "webServer" })` 别名」：能修好 404，但上游拿到面后会注册 rpc 分派与第二条 `/api/remote.mux` 的 upgrade；页面骨架里的「打开工作区」与「流式承载」会因此失效（判据走人工门：`just custom build` + 清单评审）。
- 否掉「宿主开二次端口／反向代理到上游」：本装配的 mux 与上游的 mux 是两条链，多一层转发只会让「404 是没注册还是没数据」更难分。
- 不做「`/api` 路由去重保护」：`registerUpgrade` 对同 path 重复注册是「先注册者独占」，本装配只有一条，用不上。

## 七、不做与已知债

- 不做 `/api/<channel>` 的 HTTP 形式：本装配的 typert 走自研 mux，那里 404 属预期。
- 不实现认证：`Credentials` 只转交给上游。

## 八、开放问题

- `/api` 前缀本身没有自动化用例（只有 mux 的 upgrade 有一条）：要不要给 `ConnectionDefault` 加一条「注册 prefix /api 并转交」的 spec，未定。
- `generation` 兜底值是 { id: 0, host: undefined }：上游若给 id 加了语义（排序 / 失效），这个 0 的含义要重新对一次。

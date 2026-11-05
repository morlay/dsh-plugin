# storage shim：用 IndexedDB 代理同步 `Storage`

状态：已采纳——浏览器启动前把 `window.localStorage` / `window.sessionStorage` 换成内存表的代理，读同步、写异步刷进 IndexedDB
背景：上游客户端把二者当**同步** `Storage` 用（构造期读、`JSON.parse` 立即消费），而它并不可靠：5MB 限额、清站点数据即丢（`dsh.sessions.current` 记着一个不存在的 id 就是这么来的）。换成异步后端等于去改上游每个调用点；代理能把"同步面"与"异步后端"隔在一个函数里。

**决定**

在 `bootstrapClient` 之前调用 `installStorageShim()`：`createShim` 用内存 `Map` 做唯一真源（`setItem` 之后立刻 `getItem` 必须读得到），每次写排进串行队列刷进 IndexedDB——后端选它是因为浏览器里只有它同时有事务、容量足够、且不要权限；`createWriter` 串行化同一 store 的写入，键的先后顺序因此保持。`drainNative` 把原生现有键搬进 shim，两个 shim 都装上并通过自检之后才清原生。

**考虑过的选项**

| 选项                           | 否掉的理由                                                        |
| ------------------------------ | ----------------------------------------------------------------- |
| 换掉后端、让上游改调异步接口   | 上游按同步 `Storage` 写死在构造期，改调用点是一大片上游代码的改动 |
| 继续用原生 `localStorage`      | 限额与"清缓存即丢"就是问题本身；桌面壳与多窗口下更不可靠          |
| 在壳或宿主里做一个非浏览器后端 | 这条只解决浏览器侧的同步语义；宿主侧持久化另有其道（会话落 RDB）  |

**后果**

- **同步语义的边界**：`getItem` / `length` / `key` 只读内存表——写入不保证已落盘；落盘失败只记 warn、**不回滚**内存（上游习惯写完立刻读，回滚会造出更隐蔽的不一致）。
- **失败面收在返回值里**：没有 `indexedDB`、开库失败、`defineProperty` 被静默忽略（自检发现）都返回 `{ installed: false, reason }`，调用方保留原生 storage 并记一条 warn——启动链不因此抛错。
- **两处已知缺口**：原生 `storage` 事件（跨标签页通知）不触发，本装配是单标签页；配额回收与迁移回退都没做。
- `instanceof Storage` 对 shim 为 `false`（它是六个成员的同步面，不是 DOM 实例）。
- **判据**：[`storage-shim.spec.ts`](../../src/client/__tests__/storage-shim.spec.ts) 用注入的假后端判同步语义、迁移与回落，不需要真 IndexedDB；对外只有 [`./client` 出口](../../src/client/index.ts) 上的 `installStorageShim` 与 `StorageShim` / `StorageShimResult` 三个名字。

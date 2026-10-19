# storage shim：用 IndexedDB 代理同步 `Storage`

日期：2026-10-29

## 背景

上游客户端代码把 `localStorage` / `sessionStorage` 当**同步** `Storage` 用（`getItem` 立即返回、写入立即生效），
而浏览器的持久化能力在桌面壳与多窗口下并不可靠（隐私模式、配额、清站点数据）。我们要一份**可诊断**的持久化，
同时不改上游任何一行。

## 决策

在 `bootstrapClient` 之前，把 `window.localStorage` / `window.sessionStorage` **替换成内存表的代理**：
读走内存（同步语义不变），写异步刷进 IndexedDB。

### 五条要点

1. **为什么是代理而不是直接换后端**：上游按同步 `Storage` 写死了（构造期读、`JSON.parse` 立即消费），
   换异步后端等于改上游调用点；代理把「同步面」与「异步后端」隔在 `createShim` 一个函数里。
2. **为什么后端选 IndexedDB**：`localStorage` 本身是我们替换掉的（不可靠），`IndexedDB` 是浏览器里唯一
   有事务、容量足够、且不需要权限的持久化；`createWriter` 串行化同一 key 的写入顺序（队列尾随 Promise）。
3. **同步语义的边界**：`getItem` / `length` / `key` 只读内存表——**写入不保证已落盘**；落盘失败只记 warn，
   不回滚内存（上游在 `setItem` 之后通常立刻 `getItem`，回滚会造成更隐蔽的不一致）。
4. **迁移与清原生的顺序**：开库 → 预载 → `drainNative()` 把原生现有键搬进 shim（写入已排队）→
   `defineProperty` + **自检**（有些浏览器对 `localStorage` 的 `defineProperty` 静默失败）→
   **两个 shim 都装上之后**才 `native.clear()`。任何一步抛错都返回 `{ installed: false, reason }`，
   调用方保留原生 storage 并记 warn。
5. **未实现项与兜底**：没有 `indexedDB`（老内核 / 测试环境）→ `installed: false, reason: "indexedDB 不可用"`；
   跨标签页同步、配额回收、迁移回退都**未做**——这些是已知缺口，不是没想到：
   跨标签页要靠 `BroadcastChannel`，配额要靠 `navigator.storage.persist()`，迁移回退没有可靠的判定点。

## 后果

- 上游同步语义不变，`storage-shim` 的失败面被收在 `installStorageShim()` 的返回值里；
- `createShim` / `drainNative` 导出成可测工厂：同步语义与迁移逻辑用**注入的假后端**测，不需要真 IndexedDB
  （[storage-shim.spec.ts](../../packages/zephyr/zephyr-app/src/client/__tests__/storage-shim.spec.ts)）；
- 代价：内存表与磁盘可能短暂不一致（进程被杀时丢最后几次写），以及替换原生对象本身依赖
  `defineProperty` 可写——自检覆盖它。

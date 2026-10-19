# @morlay/dsh-fs

文件系统契约（`FileSystem`）本身，让工具与沙箱共用一个读写面。

## 用法

- 导出：`FileSystem` 契约，入口是 `@morlay/dsh-fs/contract`。包根 `index.ts` 只为 `.` 出口存在，不 re-export。
- 装配：本包没有 `Module`：实现是 `@morlay/dsh-sandbox` 的 `FsSandbox` 行（它要 `SandboxPolicy` 才能挂）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

# @morlay/dsh-fs

文件系统契约（`FileSystem`）本身，让工具与沙箱共用一个读写面。

## 用法

- 导出：`FileSystem` 契约与 `FsError` / `FsVersion`（入口 `./contract`）；默认实现 `LocalFileSystem`（转发上游 `@deepseek-ai/dsh-fs-local`）随包根出。
- 本包没有装配函数：契约与实现都在本包，装配清单不属本包。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

# @morlay/dsh-ptc

PTC（programmatic tool calls，程序化工具调用）的运行时：「模型写一段程序、程序里调工具」这条路的执行面。

## 用法

- 导出：`PtcRuntime` 契约与 `PtcRuntimeDefault`（转发上游 `NodePtcRuntimeService`）。
- 装配：`PtcModule`；它注入 `FileSystem` / `Subprocess` / `Sandbox` / `SandboxPolicy`，所以装配面要同时装上沙箱与 shell 两域。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

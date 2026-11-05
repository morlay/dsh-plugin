# @morlay/dsh-workspace

工作区与会话的绑定：注册表、目录选择、变更广播，外加浏览器侧的工作区面。

## 用法

- 导出：`WorkspaceRegistry` / `DirectoryPickerBackend` 契约与 `WorkspaceControllerRow` / `DirectoryPickerControllerRow` / `SessionWorkspaceHost` 三个 host 行；浏览器半在 `./ui`。
- 契约面还出 `WorkspaceId` 品牌铸造（值）与 `WorkspaceRegistryCovered` 覆盖守卫。
- 装配函数：宿主 `provideWorkspace()` / `provideWorkspaceFiles()`（`./server`）、浏览器半 `provideWorkspaceUi()`（`./ui`）；本包不拥有装配清单。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
远程面与流式帧见[workspace 远程面与流式 wire](./.agents/designs/20261027-workspace远程面与流式wire.md)。

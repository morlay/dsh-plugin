# @morlay/dsh-workspace

工作区与会话的绑定：注册表、目录选择、变更广播，外加浏览器侧的工作区面。

## 用法

- 导出：`WorkspaceRegistry` / `DirectoryPickerBackend` 契约与 `WorkspaceControllerRow` / `DirectoryPickerControllerRow` / `SessionWorkspaceHost` 三个 host 行；浏览器半在 `@morlay/dsh-workspace/ui`。
- 装配：本包没有 `Module`：host 行由装配面直接列进行清单，浏览器半装 `WorkspaceControllerDefault` 与 `WorkspaceRemoteBinding`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

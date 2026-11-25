# @morlay/dsh-workspace

工作区与会话的绑定：注册表、目录选择、变更广播，外加浏览器侧的工作区面。

## 用法

- 导出：`WorkspaceRegistry` / `DirectoryPickerBackend` 契约与 `WorkspaceControllerRow` / `DirectoryPickerControllerRow` / `SessionWorkspaceHost` 三个 host 行；浏览器半在 `./ui`。
- 跨域编排：`SessionWorkspaceCopyHost` 实现 `@morlay/dsh-session` 的 `SessionWorkspaceCopy` 端口（把一条会话复制到目标工作区 = `SessionWorkspace` 认目标并 attach + `SessionBranching` 派生/撤销）。它住在这一侧，因为持久化行不许反向依赖 workspace 域。
- 契约面还出 `WorkspaceId` 品牌铸造（值）与 `WorkspaceRegistryCovered` 覆盖守卫；浏览器侧的数据面契约
  `WorkspaceController`（服务名 `workspaces`）在 `./endpoint`，实现是 `./ui` 的 `WorkspaceControllerDefault`。
- 装配函数：宿主 `provideWorkspace()` / `provideWorkspaceFiles()`（`./server`）、浏览器半 `provideWorkspaceUi()`（`./ui`，数据面 + 上下文菜单 + 目录选择器）；本包不拥有装配清单。
- 装上游 `ui-workspace` 的那一行（注册工作区槽位）**不在这里**：它要 `uiSession` / `uiSession.sessionStatus`，而本域在对话域下面——那一行住在 `@morlay/dsh-conversation/ui`（`provideSessionShellSlots()`），依赖反转掉这条环。
- 「起始目录」只从 `AppEnv.defaultWorkingDirectory` 读：`DefaultWorkspace` 把它登记成默认工作区，
  `SessionWorkspaceHost` 在请求没带 cwd 时用它——两处都不读进程 cwd。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
远程面与流式帧见[workspace 远程面与流式 wire](./.agents/designs/20261027-workspace远程面与流式wire.md)。

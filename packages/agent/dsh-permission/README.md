# @morlay/dsh-permission

权限三面：权限预设、用户批准、用户提问——决定一次调用能不能放行、要不要问人。

## 用法

- 导出：`Permission` / `Approval` / `UserQuestions` 三个 host 契约与默认实现；浏览器半在 `@morlay/dsh-permission/ui`。
- 装配：`PermissionModule`（host）；浏览器半装 `ApprovalModule` 与 `PermissionUiModule`（上游 `ui-permission-presets` 的 client 行）。
- 默认档位：`PermissionModule.withConfig(mode)` 给装配值；用户选过的值落在设置文档的 `permission` 命名空间
  （`{"permission":{"defaultPreset":"…"}}`），**下一次启动**生效；当前会话的切换走 `/permission` 命令。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

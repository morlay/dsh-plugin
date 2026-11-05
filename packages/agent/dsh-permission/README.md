# @morlay/dsh-permission

权限三面：权限预设、用户批准、用户提问——决定一次调用能不能放行、要不要问人。

## 用法

- 导出（包根，**宿主面**）：`Permission` / `Approval` / `UserQuestions` 三个契约与默认实现、`PermissionMode`。
- 装配（宿主）：`providePermission()`（默认档位 `workspace-write`）或 `providePermissionFor(mode)`，都从 `./server` 取。
- 浏览器半**不在本包**：远端身份只在 `./endpoint`（`PERMISSION_PRESETS_REMOTE` / `USER_QUESTIONS_REMOTE`）；包根带三个宿主 service，浏览器侧不要引包根。
- 默认档位：`providePermissionFor(mode)` 给装配值；用户选过的值落在设置文档的 `permission` 命名空间
  （`{"permission":{"defaultPreset":"…"}}`），**下一次启动**生效；当前会话的切换走 `/permission` 命令。

## 设计

出口边界（哪个面能出什么、判据怎么跑）见[出口边界与浏览器半](./.agents/designs/20261113-出口边界与浏览器半.md)；
包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

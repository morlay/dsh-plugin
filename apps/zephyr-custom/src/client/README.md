# 应用侧 client 装配

只做**装配**：框架链 + 业务链 + 上游 UI 行。视图与服务都在业务包里，应用不定义 UI。

## 按域组织

| 目录            | 负责什么                                                   | 对外令牌                                                  |
| --------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `shell/`        | 侧栏骨架、右侧面板、面板级服务                             | `services.token.ts`：`SidebarRight`、`SidebarRightTabs`   |
| `session/`      | 会话选中/状态（`ui-session`）                              | `session.token.ts`：`UiSession`                           |
| `workspace/`    | 工作区与会话树（`ui-workspace`）、目录选择                 | `workspace.token.ts`：`UiWorkspace`                       |
| `conversation/` | 会话主视图、内容渲染、各类卡片、附件、slash 菜单           | `conversation.token.ts`：`UiConversation`、`Conversation` |
| `input/`        | 输入区触发器、`/` 命令、`@` 引用、技能、计划               | `services.token.ts`：`InputTriggers`、`FileUpload`        |
| `settings/`     | 设置面板（通用 + 模型）与 `configForms` / `settingsSchema` | `settings.token.ts`：`SettingsSchema`、`CommandUi`        |
| `remotes/`      | 需要 `$mount` 的 remote namespace                          | —                                                         |
| `shared/`       | 跨域小工具（`serviceShell`）                               | —                                                         |

每个域一个 `index.ts` 导出该域的装配行；`index.ts`（本目录）只按依赖顺序把各域的行组合进 `providers`，
分组注释就是装配顺序的说明。

## 约定

- **一行一个文件**：`*.row.ts` / `*.rows.ts` 里放 `@Injectable()` 适配类，文件名说明它装的是哪个上游行。
- **服务的提供方式**：`fromCordis(契约令牌, 上游插件)`；上游在自己的 apply 里 `ctx.plugin(Service)` 的，
  拆成独立服务行（`serviceShell`）——行作用域对 `ctx.plugin` 默认**报错**。
- **令牌跨域引用**走相对路径 `../<domain>/<x>.token.ts`，不要在同域内重复定义。

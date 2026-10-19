import { provide, type ProviderList } from "@morlay/zephyr";
import { WorkspaceFilesDefault } from "./workspace-files.service.ts";

// `remote.workspaceFiles` 的宿主面：上游 `WorkspaceFiles`（读 / 列 / 观察）+ 五条 wire 端点。
//
// 单独成模块而不是塞进 `SandboxModule`：这条行还要会话存储、会话持久化、`typert` 与 wire 的 handler 表，
// 而 `SandboxModule` 是「沙箱能力」的装配面（`sandbox` / `sandboxPolicy` / `fs` / `bash`），
// 只想要那些能力的装配不该被迫装半个应用。它住在 sandbox 包，是因为要喂给上游的 `sandboxPolicy`
// 是本域自己的契约（放进 workspace 会让 `workspace → sandbox → session → workspace` 成环）。
const providers = (): ProviderList => [WorkspaceFilesDefault];

export const provideWorkspaceFiles = provide(providers());

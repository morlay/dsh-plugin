// 对话域**自己那份**整装清单：被测面（`provideConversationServer()` / `provideConversationUi()`）+ 它的依赖域。
//
// 为什么不依赖 apps 的 `customProvidersOf`：那会让「包 → 应用」的依赖方向倒过来。
//
// 两条硬约束（`session-mode-core` 聚合时试出来的）：
// 1. `provideConversationServer()` **自带三份 root**（store / 投影 / 查询）——再并列 `provideSession()`
//    就是 `service "sessions" has been registered`；feature 只作用于第 1 段。
// 2. `provideConversationUi()` 有两个前置：`provideWorkspaceUi()`（侧栏骨架要 `uiWorkspace`）与
//    `provideCommandUi()`（输入区的 `CommandUiSlot` 要 `remote.commands`）都要排在它之前。
import { configure } from "@morlay/zephyr";
import {
  AppEnvDefault,
  mountFullApp,
  provideAppEnv,
  provideApiGateway,
  provideConnection,
  provideTypert,
  provideWeb,
  type FullApp,
} from "@morlay/zephyr-app/testing";
import { provideAgent } from "@morlay/dsh-agent";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideConversationServer } from "../../server/index.ts";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { provideSandbox } from "@morlay/dsh-sandbox";
import { provideWorkspaceFiles } from "@morlay/dsh-workspace/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideShell } from "@morlay/dsh-shell/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideStorageJson } from "@morlay/dsh-storage";
import { provideUpload } from "@morlay/dsh-upload/server";
import { provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideWorkspace } from "@morlay/dsh-workspace/server";

/**
 * 起一棵「对话域宿主面够用」的行树。
 * @param dataDir - 数据根（tmpdir）。
 * @param mode - 权限档位（`main-flow` 要它；缺省 `workspace-write`）。
 * @returns 起好的整装行树。
 */
export async function mountConversationHost(
  dataDir: string,
  mode: "read-only" | "workspace-write" | "danger-full-access" = "workspace-write",
): Promise<FullApp> {
  return await mountFullApp({
    providers: [
      ...provideAuth(),
      ...provideWeb(),
      ...provideAppEnv(configure(AppEnvDefault, { profileDir: process.cwd(), dataDir })),
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      // 存储 hub 与后端必须**先于任何要落盘的行**：`SessionPersistence` 的 init 会 open 存储域，
      // 那时后端还没注册就是 `storage backend 'json' is not registered (registered: none)`。
      ...provideStorage(),
      ...provideStorageJson(),
      ...provideSessionPersistence(),
      // 端点面：数据面 + 会话引用 + 会话端点（自带三份 root，别再单列 `provideSession()`）。
      ...provideConversationServer(),
      ...provideAgent(),
      // 循环期：本装配要 `AgentLoop.create` 建会话（骨架只给契约）。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      ...provideCommand(),
      // `provideApiSession()` 的 `SessionController` 在 init 里自己 `new SessionSkillCatalog`，
      // 适配行再装一遍就是 `service "sessionSkillCatalog" has been registered`。
      ...provideAttachment(),
      ...provideUpload(),
      ...provideWorkingDirectory(),
      ...provideWorkspace(),
      ...provideWorkspaceFiles(),
      ...provideShell(),
      // 沙箱整域（`FileSystem` 的实现 `FsSandbox`）：`FileReferenceServiceRow` 要它。
      ...provideSandbox(),
      ...providePermissionFor(mode),
    ],
    dataDir,
    timeoutMs: 120_000,
  });
}

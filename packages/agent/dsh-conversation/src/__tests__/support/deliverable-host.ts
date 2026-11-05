// 交付物域**自己那份**整装清单：只装被测面 + 它的依赖域。
//
// 清单从路由行的 `inject` 反推：`connection` / `sessionQuery` / `sessionController` / `workspaceFiles` /
// `fs` / `sandboxPolicy` / `workspaceChanges`，以及 `workspaceChanges` 自己的 `subprocess`；
// `sessionController` 那行（`provideApiSession`）再往下要 agent / 附件 / 上传 / 工作区，所以清单到它为止。
//
// 为什么不依赖 apps 的 `customProvidersOf`：那会让「包 → 应用」的依赖方向倒过来。
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
import { provideCommand } from "@morlay/dsh-command/server";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideApiSession, provideSessionRemote } from "@morlay/dsh-conversation/server";
import { provideSandbox } from "@morlay/dsh-sandbox";
import { provideWorkspaceFiles } from "@morlay/dsh-workspace/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideSetting } from "@morlay/dsh-setting/server";
import { provideShell } from "@morlay/dsh-shell/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideStorageJson } from "@morlay/dsh-storage";
import { provideUpload } from "@morlay/dsh-upload/server";
import { provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { provideDeliverables } from "../../server/index.ts";

/**
 * 起一棵「交付物域够用」的行树。
 * @param dataDir - 数据根（tmpdir）。
 * @returns 起好的整装行树。
 */
export async function mountDeliverablesHost(dataDir: string): Promise<FullApp> {
  return await mountFullApp({
    providers: [
      ...provideAuth(),
      ...provideWeb(),
      ...provideAppEnv(configure(AppEnvDefault, { profileDir: process.cwd(), dataDir })),
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideSessionPersistence(),
      // `provideSessionRemote()` 自带三份 root（store / 投影 / 查询）：不能再单列 `provideSession()`，
      // 那是同一个服务名注册两次（`service "sessions" has been registered`）。
      ...provideSessionRemote(),
      ...provideAgent(),
      ...provideCommand(),
      ...provideSetting(),
      ...provideAttachment(),
      ...provideUpload(),
      ...provideStorage(),
      ...provideStorageJson(),
      ...provideWorkingDirectory(),
      ...provideWorkspace(),
      ...provideSandbox(),
      ...provideWorkspaceFiles(),
      ...provideShell(),
      ...provideApiSession(),
      ...provideDeliverables(),
    ],
    dataDir,
    timeoutMs: 120_000,
  });
}

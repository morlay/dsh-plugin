// `SessionWorkspace` 的 workspace 侧实现：把「建会话」解析到目录，并在建好后挂到 workspace 上。
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { inject, Injectable } from "@morlay/zephyr";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";
import { SessionWorkspace, type SessionWorkspaceTarget } from "@morlay/dsh-session";
import { WorkspaceBroadcaster } from "./workspace-broadcaster.service.ts";

@Injectable()
export class SessionWorkspaceHost extends SessionWorkspace {
  private readonly registry = inject(WorkspaceRegistry);

  private readonly stream = inject(WorkspaceBroadcaster);

  async resolve(request: {
    readonly workspaceId?: string;
    readonly cwd?: string;
  }): Promise<SessionWorkspaceTarget> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new Error("session.create accepts workspaceId or cwd, not both");
    }
    if (request.workspaceId === undefined) {
      return {
        // 没有 workspace 时用调用方给的目录；再没有就落在宿主进程的 cwd（本装配没有「默认项目目录」这类配置）。
        cwd: request.cwd ?? process.cwd(),
        attach: async (): Promise<void> => {},
      };
    }
    const workspaceId = request.workspaceId;
    // 品牌在工作区边界铸造一次：wire 上进来的是裸字符串，注册表按 `WorkspaceId` 索引。
    const workspace = this.registry.get(WorkspaceId(workspaceId));
    if (workspace === undefined) {
      throw new Error(`workspace "${workspaceId}" not found`);
    }
    return {
      cwd: workspace.path,
      attach: async (sessionId): Promise<void> => {
        // 上游 `attachSession` 会按会话 header 的 cwd 校验它确实属于这个 workspace 的目录。
        // 身份是调用方铸好的 `SessionId`（契约的不变量），这里原样透传、不重复铸牌。
        await workspace.attachSession(sessionId);
        // attach 之后 `sessionIds` 变了，但这条路不走 workspace 命令：不广播的话页面上看不到新会话行。
        this.stream.broadcastUpsert(workspaceId);
      },
    };
  }
}

// `SessionWorkspace` 的 workspace 侧实现：把「建会话」解析到目录，并在建好后挂到 workspace 上。
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { inject, Injectable } from "@morlay/zephyr";
import { WorkspaceRegistry } from "../contract/workspace.contract.ts";
import { SessionWorkspace, type SessionWorkspaceTarget } from "@morlay/dsh-session";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";

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
      const cwd = request.cwd ?? process.cwd();
      // **只认已注册的工作区**：默认工作区是"启动目录"，由装配面在启动时登记一次
      // （`DefaultWorkspace`），这里**不按 cwd 自动创建**——请求带了陌生目录就明确失败，
      // 免得用户的工作区列表被一堆"跑过一遍的目录"塞满。
      const target = await this.registry.resolveByPath(cwd);
      if (target === undefined) {
        throw new Error(
          `workspace: "${cwd}" 不是已注册的工作区（默认工作区是启动目录，不会按 cwd 自动创建）`,
        );
      }
      return {
        cwd: target.path,
        attach: async (sessionId): Promise<void> => {
          await target.attachSession(sessionId);
          this.stream.broadcastUpsert(String(target.id));
        },
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

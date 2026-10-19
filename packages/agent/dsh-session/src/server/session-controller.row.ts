// 宿主侧 `remote.session` 的提供者：上游 `api/session-controller` 的 `SessionController`。
//
// 它是 cordis `Service` 子类（`TypertRemoteService`），所以用 `fromCordis(契约, 类)` 双参形式装：
// `mount(ctx, config)` 会走 `new SessionController(ctx, config)`，`static inject` 的 13 个依赖
// 由 deps 逐个交出。这一行属于会话域，所以跟 `dsh-session` 走，不再挂在应用装配面上。
import { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import { AgentDefaultModel, AgentDirectory, Llm } from "@morlay/dsh-agent";
import { AttachmentStore } from "@morlay/dsh-attachment";
import { FileSystem } from "@morlay/dsh-fs";
import { FileUploadStore } from "@morlay/dsh-upload";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ApiGateway, RemoteAccess, Typert } from "@morlay/zephyr-app";
import { SessionProjectionStore } from "../contract/session-projection-store.contract.ts";
import { SessionQuery } from "../contract/session-query.contract.ts";
import { SessionControllerHost } from "./session-controller.host.ts";

/** 宿主侧 remote namespace 的契约（`remote.session` 属于它）。 */
@Injectable()
export abstract class RemoteSessionHost {
  /** 本 namespace 的绑定描述（上游 typert 生成的产物）。 */
  abstract readonly typertRemote: unknown;
}

@Injectable()
export class SessionControllerRow extends fromCordis(RemoteSessionHost, SessionController) {
  private readonly depAgentDefaultModel = inject(AgentDefaultModel);

  private readonly depAgents = inject(AgentDirectory);

  private readonly depAttachments = inject(AttachmentStore);

  private readonly depFileUploads = inject(FileUploadStore);

  private readonly depFs = inject(FileSystem);

  private readonly depLlm = inject(Llm);

  private readonly depRemoteAccess = inject(RemoteAccess);

  private readonly depSessions = inject(SessionControllerHost);

  private readonly depSessionProjections = inject(SessionProjectionStore);

  private readonly depSessionQuery = inject(SessionQuery);

  private readonly depTypert = inject(Typert);

  /** 上游 `SessionController` 0.2.2 起还要 `typertGateway`——就是 `api-gateway` 那条行（`TypertGatewayService`）。 */
  private readonly depTypertGateway = inject(ApiGateway);

  private readonly depWorkspaceRegistry = inject(WorkspaceRegistry);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(
      ctx,
      { nativeOpen: false, listWorkSliceMs: 16 },
      {
        agentDefaultModel: this.depAgentDefaultModel,
        agents: this.depAgents,
        attachments: this.depAttachments,
        fileUploads: this.depFileUploads,
        fs: this.depFs,
        llm: this.depLlm,
        remoteAccess: this.depRemoteAccess,
        sessions: this.depSessions,
        sessionProjections: this.depSessionProjections,
        sessionQuery: this.depSessionQuery,
        typert: this.depTypert,
        typertGateway: this.depTypertGateway,
        workspaceRegistry: this.depWorkspaceRegistry,
      },
    );
  }
}

// 上游 `api/session-controller` 的适配行：**会话组的全部端点都由它提供**。
//
// 为什么直接用上游：`list/create/page/follow/control/observe*/state/wait/modelCatalog/selectModel/…`
// 这些端点的语义（事件窗口、投影水位、流式帧、资源准入、错误码）全在上游那一个类里。
// 我们自写一份就等于把这些语义抄一遍，然后一条条踩它踩过的坑（这几轮已经踩过：follow 只发一帧、
// control 的投影增量没人推、`(request, signal)` 的签名分派…）。
//
// 装配约定：它的 `static inject` 是 13 个**上游服务名**，这里逐条按名字交给 `mount` 的 deps，
// 不向容器发布别名（`fromCordis` 的 deps 就是"上游按名字读"的通道）。
import SessionControllerPlugin from "@deepseek-ai/dsh-api-session-controller";
import FileReferenceServicePlugin from "@deepseek-ai/dsh-file-reference-local";
import { AgentDefaultModel, AgentDirectory, Llm } from "@morlay/dsh-agent";
import { AgentScoped } from "@morlay/dsh-agent-contract";
import { AttachmentStore } from "@morlay/dsh-attachment";
import { FileSystem } from "@morlay/dsh-fs";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SessionQuery } from "@morlay/dsh-session";
import { SessionStore, SessionWorkspace } from "@morlay/dsh-session";
import { SESSION_CONTROLLER_REMOTE } from "./session-controller.remote.ts";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { FileUploadStore } from "@morlay/dsh-upload";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { inject, Injectable, provide, type Context } from "@morlay/zephyr";
import { fromCordis, kFace } from "@morlay/zephyr/compat";
import { Connection, RemoteAccess, Typert, TypertGateway } from "@morlay/zephyr-app";
import { FileReferenceService, SessionControllerService } from "../contract/api-session.contract.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent-contract";

/**
 * 上游 `SessionController`（`session` 组的全部端点）。
 *
 * 上游 `apply` 里的 `ctx.plugin(...)`（`fileReferences` / `mediaReferences` / `skillCatalog` /
 * `archivedSessionGate`）在行 ctx 的分层下自行装载，清单不再复制它们。
 */
@Injectable()
export class ApiSessionControllerHost extends fromCordis(SessionControllerService, SessionControllerPlugin) {
  /** 默认模型：新建 agent 时读它。 */
  private readonly depDefaultModel = inject(AgentDefaultModel);

  /** agent 注册表：会话与 agent 一起建。 */
  private readonly depAgents = inject(AgentDirectory);

  /** 附件：prompt 里的图片块经它准入与读取。 */
  private readonly depAttachments = inject(AttachmentStore);

  /** 上传：prompt 里引用的上传件经它解析。 */
  private readonly depUploads = inject(FileUploadStore);

  /** 文件系统：工作区路径解析与文件读取。 */
  private readonly depFs = inject(FileSystem);

  /** 模型运行时：模型目录与调用配置。 */
  private readonly depLlm = inject(Llm);

  /**
   * 准入：**可选**。上游 `@Remote` 方法在分派前按资源判定；只装数据面的装配（纯端点测试）
   * 没有它也能起来——准入是"加一道门"，不是这条行能否工作的前提。
   */
  private readonly depRemoteAccess = inject.optional(RemoteAccess);

  /** 会话存储（上游 `SessionStore` 的适配实例）。 */
  private readonly depSessions = inject(SessionStore);

  /** 投影注册表：会话状态（权限档位、模型选择…）在宿主侧算。 */
  private readonly depProjections = inject(SessionProjectionStore);

  /** 会话查询：列表、观测与轨迹。 */
  private readonly depQuery = inject(SessionQuery);

  /** 类型化 Remote 注册表：本行把自己登记进去。 */
  private readonly depTypert = inject(Typert);

  /** 类型化 Remote 分发者：`typertGateway` 服务（我们自己的 discovery 实现）。 */
  private readonly depGateway = inject(TypertGateway);

  /** 工作区注册表：会话按 cwd 归属工作区。 */
  private readonly depWorkspaces = inject(WorkspaceRegistry);

  /**
   * 连接面：上游没写进 `static inject`，但代码里读 `ctx.connection.fetch` / `.rpc`（上传下载的路由）。
   * 不给它，装上之后第一次用到就 `Cannot read properties of undefined (reading 'fetch')`。
   */
  private readonly depConnection = inject(Connection);

  /**
   * 工作区归属：**可选**。上游 `create` 只写 `header.cwd`，不 attach 工作区——那是 workspace 域的职责，
   * 而它自己没有可用的挂点（`api-session/added` 在上游只有类型声明、没有 emit）。
   * 所以在这里包一层 `create`：建完会话按 cwd 归属（这一层是适配面，不改上游源码）。
   */
  private readonly depWorkspace = inject.optional(SessionWorkspace);

  override async onInit(ctx: Context): Promise<void> {
    // 服务端也要登记**调用描述**：`MuxServer` 靠 `typert.remotes.get(endpoint)?.mode` 判断
    // 一个端点是不是流式（流必须走 gateway 的 stream 载具）。只在客户端 `$mount` 的话，
    // 服务端看到的 `mode` 永远是 `undefined`，流式端点会被当 unary 打开并被上游拒。
    (this.depTypert.remotes as unknown as { register(contribution: unknown): unknown }).register(
      SESSION_CONTROLLER_REMOTE,
    );
    await this.mount(ctx, undefined, {
      agentDefaultModel: this.depDefaultModel,
      agents: this.depAgents,
      attachments: this.depAttachments,
      fileUploads: this.depUploads,
      fs: this.depFs,
      llm: this.depLlm,
      remoteAccess: this.depRemoteAccess,
      sessions: this.depSessions,
      sessionProjections: this.depProjections,
      sessionQuery: this.depQuery,
      typert: this.depTypert,
      typertGateway: this.depGateway,
      workspaceRegistry: this.depWorkspaces,
      connection: this.depConnection,
    });
    this.attachWorkspaceOnCreate();
  }

  /**
   * 给上游的 `create` 包一层：建完会话后按 `header.cwd` 把它挂到对应工作区。
   *
   * 上游 `ApiSessionController.createSession` 只做「建会话 + 起 agent」，工作区归属由 workspace 域负责；
   * 而那个域没有可用的挂点（`api-session/added` 上游没有 emit）。所以在适配层补这一层：
   * 调原方法 → 拿 `sessionId/cwd` → `SessionWorkspace.resolve({ cwd }).attach(sessionId)`。
   *
   * **请求指名了 `workspaceId` 就按它挂**（不能再按 cwd 推导，那会把用户选的工作区换成
   * "cwd 碰巧对应的那个"）；没指名才按 `cwd` 解析。两条都必须走这里——上游
   * `ApiSessionController` 的 `workspaceRegistry` 只出现在 `static inject` 里，它**从不**把会话挂到
   * 工作区，早退的结果是会话永远不在任何 `sessionIds` 里（界面上表现为"选了工作区，输入区还是
   * 「选择工作区」且整条禁用"）。
   *
   * 失败只留痕、不抛：归属失败不该让"建会话"这个动作失败。
   */
  private attachWorkspaceOnCreate(): void {
    const workspace = this.depWorkspace;
    const upstream = this[kFace] as { create?: unknown } | undefined;
    if (workspace === undefined || upstream === undefined || typeof upstream.create !== "function") return;
    const original = (upstream.create as (request: unknown) => Promise<unknown>).bind(upstream);
    upstream.create = async (request: unknown): Promise<unknown> => {
      const created = (await original(request)) as { sessionId?: string };
      const sessionId = created?.sessionId;
      if (sessionId === undefined) return created;
      const asked = request as { workspaceId?: string; cwd?: string } | undefined;
      // `SessionCreateValue` 只有 `sessionId`（没有 cwd）：cwd 以会话 header 为准，
      // 拿不到时退回请求里的 `cwd`。
      const cwd = this.depSessions.get(SessionId(String(sessionId)))?.header.cwd ?? asked?.cwd;
      try {
        const target = await workspace.resolve(
          asked?.workspaceId === undefined ? (cwd === undefined ? {} : { cwd }) : { workspaceId: asked.workspaceId },
        );
        // wire 上是裸字符串，边界处铸一次品牌（契约按 `SessionId` 索引）。
        await target.attach(SessionId(sessionId));
      } catch (error) {
        console.warn("[session-api] 会话归属工作区失败（会话本身已建好）：", error);
      }
      return created;
    };
  }
}


/**
 * 上游 `LocalFileReferenceService`（`fileReferences` 服务）：`@` 引用的候选来源。
 *
 * 上游把契约（\`abstract class FileReferenceService\`）与本地实现分成两个包；我们**只引用实现**，
 * 候选逻辑一行不写。端点由 \`SessionFileReferences\` 那一行提供。
 */
@AgentScoped()
@Injectable()
export class FileReferenceServiceRow extends fromCordis(FileReferenceService, FileReferenceServicePlugin) {
  private readonly depFs = inject(FileSystem);

  private readonly depAgents = inject(AgentDirectory);

  private readonly depWorkingDirectory = inject(WorkingDirectory);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.depFs,
      agents: this.depAgents,
      workingDirectory: this.depWorkingDirectory,
    });
  }
}

/**
 * 上游会话端点面的装配清单。
 *
 * 两步：先装子插件要用的 `fileReferences` 服务（上游 `LocalFileReferenceService`，我们只引用实现），
 * 再装会话组的端点行。见债：子插件的装配口径。
 */
/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class SessionApiAgentGroup extends AgentProviderGroup {
  readonly entries = [FileReferenceServiceRow];
}

export const provideApiSession = provide([SessionApiAgentGroup, 
  FileReferenceServiceRow,
  ApiSessionControllerHost,
]);

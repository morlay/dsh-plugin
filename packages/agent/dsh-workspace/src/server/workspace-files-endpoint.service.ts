// `workspaceFiles` 组的**宿主实现**：继承 `endpoint/` 的契约类，转发到上游 `WorkspaceFiles`。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里只做两件事：把 wire 上的会话身份
// 解析成上游要的 `WorkspaceFileScope`，把五个方法接到上游实例上。
//
// 我们不用上游的 typert lookup 派发（wire 由 `MuxServer` 独占），所以「wire 上的 `SessionId` →
// 上游要的 `WorkspaceFileScope`」这一步在这里自己做，口径与上游 lookup 相同：会话 header 的 `cwd`，
// 缺失时退回沙箱策略的 `workspaceRoot`（`api/workspace-files/src/index.ts:203-220`）。
//
// 应答是**裸值**（失败是异常）；`changes` 的帧也不包 `RemoteResult`（客户端按帧解，与 `workspace/follow` 同口径）。
import type {
  WorkspaceByteReadOptions,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileScope,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import {
  WorkspaceFilesEndpoint,
  type WorkspaceFilesPathRequest,
  type WorkspaceFilesReadBytesRequest,
  type WorkspaceFilesReadRequest,
} from "../endpoint/index.ts";
import { WorkspaceFilesDefault, isWorkspaceFilesFace } from "./workspace-files.service.ts";

/** unary 的 wire 不带信号：上游签名要一个 `AbortSignal`（流式那条会拿真正的取消信号）。 */
const signalOf = (): AbortSignal => new AbortController().signal;

/** wire 上的路径（相对/绝对都由上游解析；缺省给空串＝workspace 根）。 */
function pathOf(request: WorkspaceFilesPathRequest): string {
  return typeof request.path === "string" ? request.path : "";
}

/** 行窗口：缺省的空对象表示「用上游的默认分页」。 */
function rangeOf(request: WorkspaceFilesReadRequest): WorkspaceFileRange {
  return request.range ?? {};
}

/** 字节读取选项：缺省的空对象表示「整文件，受上游上限约束」。 */
function byteOptionsOf(request: WorkspaceFilesReadBytesRequest): WorkspaceByteReadOptions {
  return request.options ?? {};
}

/** `workspaceFiles` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class WorkspaceFilesEndpointRow extends WorkspaceFilesEndpoint implements OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 `WorkspaceFiles` 的适配行发布的就是 `WorkspaceFiles`（那五个方法）。 */
  private readonly files = inject(WorkspaceFilesDefault);

  private readonly sessions = inject(SessionStore);

  private readonly persistence = inject(SessionPersistence);

  private readonly sandboxPolicy = inject(SandboxPolicy);

  private readonly disposers: (() => void)[] = [];

  onInit(): void {
    // 装配期就报「上游实例与 wire 面不同步」，而不是等第一次请求炸成
    // `this.files.list is not a function`。
    if (!isWorkspaceFilesFace(this.files)) {
      throw new Error("workspaceFiles: 上游实例缺少 read / readBytes / stat / list / changes");
    }
    this.disposers.push(registerRemoteGroup(this.handlers, this));
  }

  override async list(request: WorkspaceFilesPathRequest): Promise<WorkspaceDirectoryListing> {
    return await this.files.list(await this.scopeOf(request), pathOf(request), signalOf());
  }

  override async read(request: WorkspaceFilesReadRequest): Promise<WorkspaceFileText> {
    return await this.files.read(
      await this.scopeOf(request),
      pathOf(request),
      rangeOf(request),
      signalOf(),
    );
  }

  override async readBytes(request: WorkspaceFilesReadBytesRequest): Promise<WorkspaceFileBytes> {
    return await this.files.readBytes(
      await this.scopeOf(request),
      pathOf(request),
      byteOptionsOf(request),
      signalOf(),
    );
  }

  override async stat(request: WorkspaceFilesPathRequest): Promise<WorkspaceFileStat> {
    return await this.files.stat(await this.scopeOf(request), pathOf(request), signalOf());
  }

  /** 变更帧：先解析作用域（异步），再把上游的帧原样转出去。 */
  override async *changes(
    request: WorkspaceFilesPathRequest,
    signal: AbortSignal,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    yield* this.files.changes(await this.scopeOf(request), pathOf(request), signal);
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  /**
   * wire 上的会话身份 → 上游要的 `WorkspaceFileScope`。
   * @param request - wire 命名参数（三个作用域键的哪一个都可能来）。
   * @returns 会话身份与 workspace 根。
   */
  private async scopeOf(request: WorkspaceFilesPathRequest): Promise<WorkspaceFileScope> {
    const wire = request.workspaceFileScope ?? request.workspaceFileScopeId ?? request.sessionId;
    const sessionId = SessionId(String(wire));
    const live: ReturnType<SessionStore["get"]> = this.sessions.get(sessionId);
    const stored = live === undefined ? await this.persistence.stat(sessionId) : undefined;
    const header = live?.header ?? stored?.header;
    if (header === undefined)
      throw new Error(`workspaceFiles: 会话 "${String(sessionId)}" 没有 header`);
    return { sessionId, workspaceRoot: header.cwd ?? this.sandboxPolicy.workspaceRoot };
  }
}

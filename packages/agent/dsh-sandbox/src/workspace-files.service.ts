// `workspaceFiles` 行：上游 `WorkspaceFiles` 宿主服务（`fromCordis` 接管）＋ 5 条 wire 端点。
//
// 上游提供方是 `@deepseek-ai/dsh-api-workspace-files`（`static inject = ['fs','sandboxPolicy','sessions','typert']`），
// 读/列/观察的实现（分页、字节上限、NUL 判定、变更 feed、workspace 归属校验）都在它里面，本行不重写，
// 只做两件事：把我们的服务塞进它的 `mount`；把它 `@Remote` 的五个方法接到我们的 wire 上。
//
// 我们不用上游的 typert lookup 派发（wire 由 `MuxServer` 独占），所以「wire 上的 `SessionId` → 上游要的
// `WorkspaceFileScope`」这一步在这里自己做，口径与上游 lookup 相同：会话 header 的 `cwd`，缺失时退回
// 沙箱策略的 `workspaceRoot`（`api/workspace-files/src/index.ts:203-220`）。
import WorkspaceFilesPlugin, {
  type WorkspaceByteRange,
  type WorkspaceByteReadOptions,
  type WorkspaceDirectoryListing,
  type WorkspaceFileBytes,
  type WorkspaceFileRange,
  type WorkspaceFileScope,
  type WorkspaceFileStat,
  type WorkspaceFileText,
  type WorkspaceFileWatchFrame,
} from "@deepseek-ai/dsh-api-workspace-files";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { FileSystem } from "@morlay/dsh-fs";
import { SandboxPolicy } from "./index.ts";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert, asRemoteResult } from "@morlay/zephyr-app";

/** 上游 `WorkspaceFiles` 里本行要转发的成员（形状直接取上游，签名不另抄）。 */
type WorkspaceFilesFace = Pick<
  WorkspaceFilesPlugin,
  "read" | "readBytes" | "stat" | "list" | "changes"
>;

/**
 * `providerInstance` 在上游适配面里的类型是 `object | undefined`：按**运行时**校验收窄（同 `directory-picker`）。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns 五个方法齐备时是真。
 */
function isWorkspaceFilesFace(value: unknown): value is WorkspaceFilesFace {
  return (
    value !== null &&
    typeof value === "object" &&
    ["read", "readBytes", "stat", "list", "changes"].every(
      (name) => name in value && typeof (value as Record<string, unknown>)[name] === "function",
    )
  );
}

/** unary 的 wire 不带信号：上游签名要一个 `AbortSignal`（流式那条会拿真正的取消信号）。 */
const signalOf = (): AbortSignal => new AbortController().signal;

@Injectable()
export class WorkspaceFilesDefault extends fromCordis(WorkspaceFilesPlugin) {
  private readonly fs = inject(FileSystem);

  private readonly sandboxPolicy = inject(SandboxPolicy);

  private readonly sessions = inject(SessionStore);

  private readonly persistence = inject(SessionPersistence);

  private readonly typert = inject(Typert);

  private readonly handlers = inject(RemoteHandlers);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.fs,
      sandboxPolicy: this.sandboxPolicy,
      sessions: this.sessions,
      typert: this.typert,
    });
    const files = this.providerInstance;
    if (files === undefined || !isWorkspaceFilesFace(files)) {
      throw new Error("workspaceFiles: 上游实例缺少 read / readBytes / stat / list / changes");
    }
    this.handlers.register("workspaceFiles/list", async (args) =>
      asRemoteResult<WorkspaceDirectoryListing>(async () =>
        files.list(await this.scopeOf(args), pathOf(args), signalOf()),
      ),
    );
    this.handlers.register("workspaceFiles/read", async (args) =>
      asRemoteResult<WorkspaceFileText>(async () =>
        files.read(await this.scopeOf(args), pathOf(args), rangeOf(args), signalOf()),
      ),
    );
    this.handlers.register("workspaceFiles/readBytes", async (args) =>
      asRemoteResult<WorkspaceFileBytes>(async () =>
        files.readBytes(await this.scopeOf(args), pathOf(args), byteOptionsOf(args), signalOf()),
      ),
    );
    this.handlers.register("workspaceFiles/stat", async (args) =>
      asRemoteResult<WorkspaceFileStat>(async () =>
        files.stat(await this.scopeOf(args), pathOf(args), signalOf()),
      ),
    );
    // 流式：帧**不**包 `RemoteResult`（与 `workspace/follow` 同口径，客户端按帧解）。
    this.handlers.registerStream("workspaceFiles/changes", (args, signal) =>
      this.changesOf(files, args, signal),
    );
  }

  /** 变更帧：先解析作用域（异步），再把上游的帧原样转出去。 */
  private async *changesOf(
    files: WorkspaceFilesFace,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): AsyncGenerator<WorkspaceFileWatchFrame> {
    yield* files.changes(await this.scopeOf(args), pathOf(args), signal);
  }

  /**
   * wire 上的会话身份 → 上游要的 `WorkspaceFileScope`。
   * @param args - wire 命名参数。
   * @returns 会话身份与 workspace 根。
   */
  private async scopeOf(args: Readonly<Record<string, unknown>>): Promise<WorkspaceFileScope> {
    // 我们的客户端按 descriptor 的 `name` 发（`workspaceFileScope`）；上游生成面按 `wire` 名发
    // （`workspaceFileScopeId`）。两个都认，免得换客户端就崩。
    const wire = args.workspaceFileScope ?? args.workspaceFileScopeId ?? args.sessionId;
    const sessionId = SessionId(String(wire));
    const live: ReturnType<SessionStore["get"]> = this.sessions.get(sessionId);
    const stored = live === undefined ? await this.persistence.stat(sessionId) : undefined;
    const header = live?.header ?? stored?.header;
    if (header === undefined) throw new Error(`workspaceFiles: 会话 "${String(sessionId)}" 没有 header`);
    return { sessionId, workspaceRoot: header.cwd ?? this.sandboxPolicy.workspaceRoot };
  }
}

/** wire 上的路径（相对/绝对都由上游解析；缺省给空串＝workspace 根）。 */
function pathOf(args: Readonly<Record<string, unknown>>): string {
  return typeof args.path === "string" ? args.path : "";
}

/** 行窗口：缺省的空对象表示「用上游的默认分页」。 */
function rangeOf(args: Readonly<Record<string, unknown>>): WorkspaceFileRange {
  return (args.range ?? {}) as WorkspaceFileRange;
}

/** 字节读取选项：缺省的空对象表示「整文件，受上游上限约束」。 */
function byteOptionsOf(args: Readonly<Record<string, unknown>>): WorkspaceByteReadOptions {
  return (args.options ?? {}) as WorkspaceByteReadOptions;
}

export type { WorkspaceByteRange, WorkspaceFileWatchFrame };

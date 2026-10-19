// 测试用 workspace 注册表：内存实现，成员与 `WorkspaceRegistry` 契约**逐条对齐**。
//
// 这里不用 `as never` 抹类型：契约新增/改名时这个替身应当编译失败（它是接口漂移的第二重保障）。
// 行的形状同样取自契约（`get` 的返回类型），所以 `Workspace` 的成员变了也会在这里红。
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { Injectable } from "@morlay/zephyr";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";

/** 一行工作区：形状直接取契约 `get` 的返回类型（不另抄一份）。 */
export type FakeWorkspace = NonNullable<ReturnType<WorkspaceRegistry["get"]>>;

/** 挂载记录（供 `SessionWorkspace` 的用例断言）。 */
export interface AttachRecord {
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * 造一行工作区。
 * @param path - 工作区目录（同时派生 id 与标题）。
 * @param onAttach - `attachSession` 被调用时收到通知（记录到注册表里）。
 * @returns 满足 `Workspace` 形状的行。
 */
export function workspaceOf(path: string, onAttach?: (sessionId: string) => void): FakeWorkspace {
  return {
    id: WorkspaceId(`w-${path}`),
    path,
    title: path.split("/").at(-1) ?? path,
    sessionIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    setTitle: async (): Promise<void> => {},
    attachSession: async (sessionId): Promise<void> => {
      onAttach?.(sessionId);
    },
    insertSessionBefore: async (): Promise<void> => {},
    detachSession: async (): Promise<void> => {},
    status: async (): Promise<"ok" | "missing-dir"> => "ok",
  };
}

/** 内存注册表。 */
@Injectable()
export class FakeWorkspaceRegistry extends WorkspaceRegistry {
  readonly rows: FakeWorkspace[] = [];

  /** workspaceId → 那一行的挂载动作（供 `SessionWorkspace` 的用例断言）。 */
  readonly attached: AttachRecord[] = [];

  readonly archivedSessionIds: WorkspaceRegistry["archivedSessionIds"] = [];

  readonly pinnedSessionIds: WorkspaceRegistry["pinnedSessionIds"] = [];

  readonly initializeDefault: WorkspaceRegistry["initializeDefault"] = async () => undefined;

  readonly create: WorkspaceRegistry["create"] = async (path) => {
    const workspace = workspaceOf(path, (sessionId) => {
      this.attached.push({ workspaceId: `w-${path}`, sessionId });
    });
    this.rows.push(workspace);
    return workspace;
  };

  readonly resolveByPath: WorkspaceRegistry["resolveByPath"] = async (path) =>
    this.rows.find((row) => row.path === path);

  readonly get: WorkspaceRegistry["get"] = (id) => this.rows.find((row) => row.id === id);

  readonly list: WorkspaceRegistry["list"] = () => [...this.rows];

  readonly delete: WorkspaceRegistry["delete"] = async () => true;

  readonly insertBefore: WorkspaceRegistry["insertBefore"] = async () => [];

  readonly archiveSession: WorkspaceRegistry["archiveSession"] = async (): Promise<void> => {};

  readonly unarchiveSession: WorkspaceRegistry["unarchiveSession"] = async (): Promise<void> => {};

  readonly pinSession: WorkspaceRegistry["pinSession"] = async (): Promise<void> => {};

  readonly unpinSession: WorkspaceRegistry["unpinSession"] = async (): Promise<void> => {};
}

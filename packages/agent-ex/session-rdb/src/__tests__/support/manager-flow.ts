// 对话管理页的 L3 装配：宿主半（`startHost`：真 wire + 真库 + mock 模型目录）+
// 浏览器半（真端点客户端 + 真 controller）。页面由用例直接渲染，`face` 从这里拿。
//
// 替身只剩两件：工作区列表的客户端快照（工作区记录的 owner 在 workspace 域，跨工作区复制只读它的列表）
// 与上游 composer 的刷新面。**归档不在这里造假**：`archiveSession` 走 storage 接管那条真写穿
// （workspace 域的 global → `syncSessionFlags` → 会话行的 `f_archived_at`），与生产同一条路。
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { asRdbStore } from "@morlay/session-rdb";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import type { WorkspaceDomainState } from "@morlay/dsh-workspace/contract";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { LocalRemote } from "@morlay/zephyr-app/testing";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { ToolCallId } from "@morlay/dsh-agent/contract";
import { SessionSeq, type SessionEvent } from "@morlay/dsh-session/contract";
import { eventOf, meta, titleEvent, turnLog } from "@morlay/dsh-session/testing";
import { mountRows, type MountedRows, type RowEntry } from "./base.ts";
import { startHost, type Host } from "./e2e-host.ts";
import { openInitializedSqlite } from "./sqlite.ts";
import { ConversationManagerController } from "../../ui/conversation-manager/conversation-manager.controller.ts";
import type { ConversationManagerFace } from "../../ui/conversation-manager/conversation-manager.controller.ts";
import { SessionAdminEndpointClient } from "../../ui/conversation-manager/session-admin-endpoint.client.ts";

/** 跨工作区复制的目标工作区：真实目录 + 工作区域里的一行（页面从注入列表里看到同一行）。 */
export interface ManagerTargetWorkspace {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

/** 对话管理页的一份全链路装配。 */
export interface ManagerFlow {
  readonly host: Host;
  readonly face: ConversationManagerFace;
  readonly targetWorkspace: ManagerTargetWorkspace;
  /** 库里已归档的会话 id：经 storage 接管读 workspace 域（与页面过滤读的是同一份标记）。 */
  archivedSessionIds(): Promise<readonly string[]>;
  dispose(): Promise<void>;
}

const TARGET_WORKSPACE_TITLE = "目标工作区";

// 归档集合的初值：workspace 域第一次落 global 时的那份空状态（`initialized` 是域的既有字段）。
const EMPTY_WORKSPACE_STATE: WorkspaceDomainState = {
  initialized: true,
  workspaceIds: [],
  archivedSessionIds: [],
  pinnedSessionIds: [],
};

const WORKSPACE_DOMAIN = "workspace";

// workspace 域的 global 文档（归档 / 钉住两个集合在这里）。
async function workspaceState(host: Host): Promise<WorkspaceDomainState> {
  const state = await (
    await asRdbStore(host.persistence).storageRepository()
  ).readDomainGlobal(WORKSPACE_DOMAIN);
  return (state ?? EMPTY_WORKSPACE_STATE) as WorkspaceDomainState;
}

// 改归档集合：写 workspace 域的 global，由 storage 接管写穿到会话行（`syncSessionFlags`）。
async function writeArchived(
  host: Host,
  mutate: (archived: readonly string[]) => readonly string[],
): Promise<void> {
  const repository = await asRdbStore(host.persistence).storageRepository();
  const state = await workspaceState(host);
  const archived = mutate(state.archivedSessionIds.map(String));
  await repository.writeDomainGlobal(WORKSPACE_DOMAIN, { ...state, archivedSessionIds: archived });
}

// 上游 registry 只接受**已知**会话：未知 id 给 `session/not-found`（`WorkspaceArchiveError` 的形状）。
function unknownSession(sessionId: string): Error {
  const message = `session "${sessionId}" not found`;
  return Object.assign(
    new Error(`workspace session archive failed: session/not-found: ${message}`),
    {
      name: "WorkspaceArchiveError",
      rpcError: { code: "session/not-found", message },
    },
  );
}

// 归档面：workspace 域的那一个动作，写的是真写穿；未知会话与上游 registry 一样拒绝。
function archiveFace(host: Host) {
  return {
    archiveSession: async (sessionId: string): Promise<void> => {
      if ((await asRdbStore(host.persistence).headerOf(sessionId)) === undefined) {
        throw unknownSession(sessionId);
      }
      await writeArchived(host, (archived) =>
        archived.includes(sessionId) ? archived : [...archived, sessionId],
      );
    },
    unarchiveSession: async (sessionId: string): Promise<void> => {
      await writeArchived(host, (archived) => archived.filter((id) => id !== sessionId));
    },
  };
}

// 上游 composer 的刷新面：动作成功后 controller 会调它。
const sessionControllerStub = {
  refresh: async (): Promise<void> => undefined,
};

/**
 * 起一份对话管理页的全链路装配。
 *
 * @returns 宿主面、页面动作面与卸载函数。
 */
export async function startManagerFlow(): Promise<ManagerFlow> {
  const host = await startHost();
  // 目标工作区：真实目录（workspace 的 attach 会校验 cwd 与目录），并在工作区域里登记一行。
  // 目录名就是工作区标题（工作区的行按目录名造标题），页面上的选择项因此是可读的那一个。
  const targetPath = join(host.root, TARGET_WORKSPACE_TITLE);
  await mkdir(targetPath);
  const target = await host.workspaces.create(targetPath);
  const targetWorkspace: ManagerTargetWorkspace = {
    id: String(target.id),
    title: TARGET_WORKSPACE_TITLE,
    path: targetPath,
  };
  // 工作区列表的客户端快照替身：返回工作区域里的那几行（页面只读 id 与标题）。
  const workspaceListStub = {
    list: {
      getSnapshot: () => ({
        items: host.workspaces.rows.map((row) => ({
          workspaceId: row.id,
          path: row.path,
          title: row.title,
          sessionIds: row.sessionIds,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        archivedSessionIds: [],
        pinnedSessionIds: [],
        state: "idle" as const,
        phase: "ready" as const,
        error: null,
      }),
      subscribe: () => () => undefined,
    },
  };
  const rows: readonly RowEntry[] = [
    { provide: RemoteHandlers, useValue: host.handlers },
    { provide: SessionController, useValue: sessionControllerStub },
    { provide: UiWorkspace, useValue: archiveFace(host) },
    { provide: WorkspaceController, useValue: workspaceListStub },
    LocalRemote,
    SessionAdminEndpointClient,
    ConversationManagerController,
  ];
  const app: MountedRows = await mountRows(rows);
  const controller = app.get(ConversationManagerController);
  return {
    host,
    face: controller.face,
    targetWorkspace,
    archivedSessionIds: async () => (await workspaceState(host)).archivedSessionIds.map(String),
    async dispose() {
      await app.dispose();
      await host.dispose();
    },
  };
}

// 一条会话：日志 + 标题事件（写路径只从 session/title 折 f_title 列）。
function titledLog(title: string, id: string): SessionEvent[] {
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: title }] });
  return [...log, titleEvent(log.length, title)];
}

/**
 * 落一条带标题的会话（真写路径：create + append + close）。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 * @param title - 列表里看到的标题。
 */
export async function seedTitledSession(host: Host, id: string, title: string): Promise<void> {
  const handle = await host.persistence.create(meta(id));
  await handle.append(titledLog(title, id));
  await handle.close();
}

/**
 * 造归档前置状态（删除只对已归档的会话开放）：走 workspace 域的归档集合，
 * 由 storage 接管写穿到会话行——与页面上的归档按钮同一条路，只是不带页面。
 *
 * @param host - 宿主装配。
 * @param ids - 要标记为已归档的会话 id。
 */
export async function archiveSessionsInDb(host: Host, ids: readonly string[]): Promise<void> {
  await writeArchived(host, (archived) => [...new Set([...archived, ...ids])]);
}

/**
 * 删一个会话（真删除路径：只允许已归档且不在运行中的会话）。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 */
export async function deleteSessionInDb(host: Host, id: string): Promise<void> {
  await asRdbStore(host.persistence).deleteSession(id);
}

/**
 * 落一条带标题的会话，并把整段日志的事件时间钉在 `at`（列表的 `updatedAt` 取最后活动时间）。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 * @param title - 列表里看到的标题。
 * @param at - 事件时刻（毫秒）；决定这一行在时间筛选里属于哪一天。
 */
export async function seedSessionAt(
  host: Host,
  id: string,
  title: string,
  at: number,
): Promise<void> {
  const handle = await host.persistence.create(meta(id));
  await handle.append(
    titledLog(title, id).map((event) => ({ ...event, time: at }) as SessionEvent),
  );
  await handle.close();
}

/**
 * 落一条带标题的会话，日志里有一个名为 `toolName` 的 `tool/call`（定位用例按工具名命中它）。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 * @param title - 列表里看到的标题。
 * @param toolName - 工具名（事件行的 `f_name` 列）。
 * @returns 那条 `tool/call` 的 seq。
 */
export async function seedToolSession(
  host: Host,
  id: string,
  title: string,
  toolName: string,
): Promise<number> {
  const log = titledLog(title, id);
  // tool/call 不是 surface 事件（不能带 surfaceOp）：按事件契约给全 turn/step/callId/name/arguments，
  // 维度列（f_name）从 name 折出来。
  const userIndex = log.findIndex((event) => event.type === "user/message");
  if (userIndex < 0) throw new Error("titledLog 里应当有 user/message");
  const user = log[userIndex]!;
  // 插在用户输入之后（与它同一时刻），整段重编号：seq 必须从 0 连续（桥接表的序号就是日志位置）。
  const call = {
    ...eventOf("tool/call", userIndex + 1, {
      turn: 1,
      step: 1,
      callId: ToolCallId(id + "-call"),
      name: toolName,
      arguments: JSON.stringify({ path: "notes.md" }),
    }),
    time: user.time,
  };
  const shape = [
    ...log.slice(0, userIndex + 1),
    call,
    ...log.slice(userIndex + 1),
  ] as SessionEvent[];
  const events = shape.map((event, index) => ({ ...event, seq: SessionSeq(index) }));
  const handle = await host.persistence.create(meta(id));
  await handle.append(events);
  await handle.close();
  return events.findIndex((event) => event.type === "tool/call");
}

/**
 * 把某个 seq 的事件行写坏：已提交区里的坏行读路径直接拒绝，这份会话从库里读不出来。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 * @param seq - 要写坏的序号。
 */
export async function corruptSessionEvent(host: Host, id: string, seq: number): Promise<void> {
  const sqlite = await openInitializedSqlite(host.dbPath, "wal");
  try {
    sqlite
      .prepare(
        "UPDATE t_events SET f_data = '{' WHERE f_event_id = " +
          "(SELECT f_event_id FROM t_session_events WHERE f_session_id = ? AND f_sequence = ?)",
      )
      .run(id, seq);
  } finally {
    sqlite.close();
  }
}

/**
 * 删掉一个会话的活动计数行：旁路累加漏记的形态，体检要能读出来。
 *
 * @param host - 宿主装配。
 * @param id - 会话 id。
 */
export async function dropSessionCounts(host: Host, id: string): Promise<void> {
  const sqlite = await openInitializedSqlite(host.dbPath, "wal");
  try {
    sqlite.prepare("DELETE FROM t_session_counts WHERE f_session_id = ?").run(id);
  } finally {
    sqlite.close();
  }
}

// 对话管理页的 L3 装配：宿主半（`startHost`：真 wire + 真库 + mock 模型目录）+
// 浏览器半（真端点客户端 + 真 controller）。页面由用例直接渲染，`face` 从这里拿。
//
// 替身只有三件：workspace 的归档动作（本用例的归档标记直接打在库里）、工作区列表的客户端快照
// （工作区记录的 owner 在 workspace 域，跨工作区复制只读它的列表）与上游 composer 的刷新面。
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { LocalRemote } from "@morlay/zephyr-app/testing";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { meta, turnLog } from "@morlay/dsh-session/testing";
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
  dispose(): Promise<void>;
}

const TARGET_WORKSPACE_TITLE = "目标工作区";

// 归档动作的替身：本用例的归档状态直接写库（归档的 owner 在 workspace 域，不在这条链上）。
const workspaceStub = {
  archiveSession: async (): Promise<void> => undefined,
  unarchiveSession: async (): Promise<void> => undefined,
};

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
    { provide: RemoteHandlers as never, useValue: host.handlers },
    { provide: SessionController as never, useValue: sessionControllerStub },
    { provide: UiWorkspace as never, useValue: workspaceStub },
    { provide: WorkspaceController as never, useValue: workspaceListStub },
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
    async dispose() {
      await app.dispose();
      await host.dispose();
    },
  };
}

// 一条会话：日志 + 标题事件（写路径只从 session/title 折 f_title 列）。
function titledLog(title: string, id: string): SessionEvent[] {
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: title }] });
  return [
    ...log,
    {
      type: "session/title",
      seq: log.length,
      time: log.length,
      data: { title, messageSeqs: [], source: "auto" },
    } as unknown as SessionEvent,
  ];
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
 * 直接打归档标记（归档动作归 workspace 域；这里只造删除的前置状态）。
 *
 * @param host - 宿主装配。
 * @param ids - 要标记为已归档的会话 id。
 */
export async function archiveSessionsInDb(host: Host, ids: readonly string[]): Promise<void> {
  const sqlite = await openInitializedSqlite(host.dbPath, "wal");
  try {
    for (const id of ids) {
      sqlite.prepare("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = ?").run(id);
    }
  } finally {
    sqlite.close();
  }
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

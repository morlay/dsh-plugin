// 对话管理页的动作面：页面只见数据与回调，wire 与下载细节收在这里。
//
// 列表 / 删除 / 导入 / 导出 / 整理 / 用量走 `sessionAdmin` 组；归档与取消归档不重复提供，
// 仍归 `uiWorkspace`（它的 __h 是归档状态的 owner）。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { WorkspaceController } from "@morlay/dsh-workspace/endpoint";
import { UiWorkspace } from "@morlay/dsh-conversation/contract";
import type {
  SessionBulkDeleteValue,
  SessionConsistencyValue,
  SessionExportManyValue,
  SessionImportManyValue,
  SessionLocateRequest,
  SessionLocateValue,
  SessionOrganizeValue,
  SessionRepairAction,
  SessionRepairValue,
  SessionRowsItem,
  SessionRowsRequest,
  SessionUsageRange,
  SessionUsageValue,
} from "@morlay/session-rdb/endpoint";
import { SessionAdminEndpointClient } from "./session-admin-endpoint.client.ts";

// 一行会话（页面用的视图形状）：标题已兜底、工作区已摊平。
export interface ConversationManagerRow {
  readonly sessionId: string;
  readonly title: string;
  readonly origin: string | null;
  readonly updatedAt: number;
  readonly archived: boolean;
  readonly workspace: string | null;
}

export interface ConversationManagerRowsPage {
  readonly items: readonly SessionRowsItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// 工作区选择项（复制到工作区用）：id 与标题都取 workspace 域自己的列表。
export interface ConversationWorkspaceOption {
  readonly workspaceId: string;
  readonly title: string;
}

// 导入的阶段：读文件（浏览器侧编码成 base64）→ 写会话（宿主侧新建或整段替换）。
// 页面按阶段给提示；长任务没有取消面，阶段只是让用户知道走到了哪一步。
export type ConversationImportStage = "reading" | "committing";

export interface ConversationImportOptions {
  // 给了就覆盖该会话的日志（整段替换）；不给就是新建一个会话。
  readonly sessionId?: string;
  // 阶段变化时回调，页面据此换提示文案。
  readonly onStage?: (stage: ConversationImportStage) => void;
}

// 页面从注入面拿到的动作（属性语法：页面解构后直接调用，不绑 this）。
export interface ConversationManagerFace {
  listRows: (query?: SessionRowsRequest) => Promise<ConversationManagerRowsPage>;
  archive: (sessionId: string) => Promise<void>;
  unarchive: (sessionId: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  bulkDelete: (sessionIds: readonly string[]) => Promise<SessionBulkDeleteValue>;
  exportZip: (sessionId: string) => Promise<void>;
  // 按当前筛选结果批量导出：命中集逐页收全，再逐条落成下载。
  exportFiltered: (query?: SessionRowsRequest) => Promise<SessionExportManyValue>;
  importZip: (file: File, options?: ConversationImportOptions) => Promise<string>;
  // 批量导入：多选 zip 一次请求（`sessionAdmin/importMany`），逐条结果交回页面聚合。
  importMany: (files: readonly File[]) => Promise<SessionImportManyValue>;
  // 事件定位（只读）：条件下推到宿主，回 seq 窗口与命中片段。
  locateEvents: (sessionId: string, query: ConversationLocateQuery) => Promise<SessionLocateValue>;
  // 工作区选择项与跨工作区复制（复制 = fork + workspace 的 attach，源会话保留）。
  listWorkspaces: () => Promise<readonly ConversationWorkspaceOption[]>;
  copyToWorkspace: (
    sessionId: string,
    workspaceId: string,
  ) => Promise<{ readonly sessionId: string; readonly workspaceId: string }>;
  organizeData: () => Promise<SessionOrganizeValue>;
  loadUsage: (range: SessionUsageRange) => Promise<SessionUsageValue>;
  // 体检（只报不修）与坏会话的三个修法。
  checkConsistency: () => Promise<SessionConsistencyValue>;
  repairSession: (sessionId: string, action: SessionRepairAction) => Promise<SessionRepairValue>;
}

// 事件定位的条件：会话身份走第一个参数（与 `sessionAdmin/locate` 的请求同形去掉它）。
export type ConversationLocateQuery = Omit<SessionLocateRequest, "sessionId">;

// 带宿主错误码的失败：页面据此选本地化文案。
export class ConversationManagerRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "ConversationManagerRequestError";
  }
}

// wire 的结果封装：`ok: false` 时页面按 `code` 选文案。
interface WireOutcome<T> {
  readonly ok?: boolean;
  readonly value?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

// 解开一次 unary 结果：失败折成带 code 的错误。
function unwrap<T>(outcome: unknown): T {
  const wire = outcome as WireOutcome<T> | undefined;
  if (wire === undefined)
    throw new ConversationManagerRequestError("sessionAdmin 未接通", undefined);
  if (wire.ok === false) {
    throw new ConversationManagerRequestError(wire.error?.message ?? "请求失败", wire.error?.code);
  }
  return wire.value as T;
}

// 批量导出时收 id 的一页大小：与端点的 pageSize 上限同一个数。
const EXPORT_PAGE_SIZE = 200;

// 选中的 zip 读成 base64：remote 只走 JSON，二进制要自己编码。
async function zipBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("failed to read the selected file"));
    };
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

// base64 → blob：导出的 zip 从这里进浏览器下载。
function zipBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "application/zip" });
}

// 浏览器下载：blob URL + 一次性 anchor；URL 在下一轮事件循环回收。
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

@Injectable()
export class ConversationManagerController {
  private readonly endpoint = inject(SessionAdminEndpointClient);

  private readonly workspace = inject(UiWorkspace);

  // 工作区列表的 owner 是 workspace 域（本包不反查会话库里的投影）。
  private readonly workspaces = inject(WorkspaceController);

  private readonly sessions = inject(SessionController);

  readonly face: ConversationManagerFace = {
    listRows: (query) => this.listRows(query ?? {}),
    archive: async (sessionId) => {
      await this.delegate(() => this.workspace.archiveSession(SessionId(sessionId)));
    },
    unarchive: async (sessionId) => {
      await this.delegate(() => this.workspace.unarchiveSession(SessionId(sessionId)));
    },
    remove: (sessionId) => this.remove(sessionId),
    bulkDelete: (sessionIds) => this.bulkDelete(sessionIds),
    exportZip: (sessionId) => this.exportZip(sessionId),
    exportFiltered: (query) => this.exportFiltered(query ?? {}),
    importZip: (file, options) => this.importZip(file, options),
    importMany: (files) => this.importMany(files),
    locateEvents: (sessionId, query) => this.locateEvents(sessionId, query),
    listWorkspaces: () => this.listWorkspaces(),
    copyToWorkspace: (sessionId, workspaceId) => this.copyToWorkspace(sessionId, workspaceId),
    organizeData: () => this.organizeData(),
    loadUsage: (range) => this.loadUsage(range),
    checkConsistency: () => this.checkConsistency(),
    repairSession: (sessionId, action) => this.repairSession(sessionId, action),
  };

  private async listRows(query: SessionRowsRequest): Promise<ConversationManagerRowsPage> {
    const value = unwrap<ConversationManagerRowsPage>(await this.endpoint.rows(query));
    if (!Array.isArray(value.items) || typeof value.total !== "number") {
      throw new ConversationManagerRequestError("会话列表响应不可用", undefined);
    }
    return value;
  }

  private async remove(sessionId: string): Promise<void> {
    unwrap(await this.endpoint.delete({ sessionId }));
    await this.refresh();
  }

  // 批量删除：整批一次请求，结果逐条交回（失败的项带码）；动作成功后重拉列表。
  private async bulkDelete(sessionIds: readonly string[]): Promise<SessionBulkDeleteValue> {
    const value = unwrap<SessionBulkDeleteValue>(await this.endpoint.bulkDelete({ sessionIds }));
    if (!Array.isArray(value.items)) {
      throw new ConversationManagerRequestError("批量删除响应不可用", undefined);
    }
    await this.refresh();
    return value;
  }

  private async exportZip(sessionId: string): Promise<void> {
    const value = unwrap<{ filename: string; zip: string }>(
      await this.endpoint.export({ sessionId }),
    );
    downloadBlob(zipBlob(value.zip), value.filename);
  }

  // 批量导出：先按筛选把命中集的 id 收全（列表一页一页翻），再一次性交给宿主逐条导出。
  private async exportFiltered(query: SessionRowsRequest): Promise<SessionExportManyValue> {
    const sessionIds = await this.filteredIds(query);
    if (sessionIds.length === 0) return { items: [] };
    const value = unwrap<SessionExportManyValue>(await this.endpoint.exportMany({ sessionIds }));
    if (!Array.isArray(value.items)) {
      throw new ConversationManagerRequestError("批量导出响应不可用", undefined);
    }
    for (const item of value.items) {
      // 失败条只有码：页面按整批提示聚合成一句话，不逐条弹。
      if (!item.ok || item.zip === undefined || item.filename === undefined) continue;
      downloadBlob(zipBlob(item.zip), item.filename);
    }
    return value;
  }

  // 命中集的 id：端点的每页上限是 200，筛选结果可能不止一页。
  private async filteredIds(query: SessionRowsRequest): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const value = unwrap<ConversationManagerRowsPage>(
        await this.endpoint.rows({ ...query, page, pageSize: EXPORT_PAGE_SIZE }),
      );
      if (!Array.isArray(value.items)) {
        throw new ConversationManagerRequestError("会话列表响应不可用", undefined);
      }
      for (const item of value.items) ids.push(item.sessionId);
      if (value.items.length === 0 || ids.length >= value.total) return ids;
    }
  }

  // 归档委托 workspace 域：它的失败面是自己的域码（`rpcError.code`），折成我们这一层的可读原因。
  // 只映射语义重合的那一条（未知会话 = 会话不存在）；其余码保留原文，不硬翻译跨域的词。
  private async delegate(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      const rpc = (error as { rpcError?: { code?: string; message?: string } } | null)?.rpcError;
      if (rpc?.code === "session/not-found") {
        throw new ConversationManagerRequestError(
          rpc.message ?? "session not found",
          "SESSION_NOT_FOUND",
        );
      }
      throw error;
    }
  }

  // 批量导入：一次请求带上全部包（remote 只走 JSON，逐条 base64），结果逐条交回页面聚合。
  private async importMany(files: readonly File[]): Promise<SessionImportManyValue> {
    const zips = await Promise.all(files.map((file) => zipBase64(file)));
    const value = unwrap<SessionImportManyValue>(await this.endpoint.importMany({ zips }));
    if (!Array.isArray(value.items)) {
      throw new ConversationManagerRequestError("批量导入响应不可用", undefined);
    }
    await this.refresh();
    return value;
  }

  // 事件定位：只读的行的读，条件下推；窗口合法性由宿主判，这里不重复一套。
  private async locateEvents(
    sessionId: string,
    query: ConversationLocateQuery,
  ): Promise<SessionLocateValue> {
    const value = unwrap<SessionLocateValue>(await this.endpoint.locate({ sessionId, ...query }));
    if (!Array.isArray(value.items)) {
      throw new ConversationManagerRequestError("事件定位响应不可用", undefined);
    }
    return value;
  }

  private async importZip(file: File, options: ConversationImportOptions = {}): Promise<string> {
    options.onStage?.("reading");
    const zip = await zipBase64(file);
    options.onStage?.("committing");
    const value = unwrap<{ sessionId: string }>(
      await this.endpoint.import({
        zip,
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      }),
    );
    await this.refresh();
    return value.sessionId;
  }

  // 工作区列表：浏览器侧的快照（workspace 域维护），只取 id 与标题给选择项。
  private async listWorkspaces(): Promise<readonly ConversationWorkspaceOption[]> {
    return this.workspaces.list.getSnapshot().items.map((workspace) => ({
      workspaceId: String(workspace.workspaceId),
      title: workspace.title,
    }));
  }

  private async copyToWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<{ readonly sessionId: string; readonly workspaceId: string }> {
    const value = unwrap<{ sessionId: string; workspaceId: string }>(
      await this.endpoint.copyToWorkspace({ sessionId, workspaceId }),
    );
    if (typeof value.sessionId !== "string") {
      throw new ConversationManagerRequestError("复制响应不可用", undefined);
    }
    await this.refresh();
    return value;
  }

  private async organizeData(): Promise<SessionOrganizeValue> {
    const value = unwrap<SessionOrganizeValue>(await this.endpoint.organize());
    await this.refresh();
    return value;
  }

  private async checkConsistency(): Promise<SessionConsistencyValue> {
    const value = unwrap<SessionConsistencyValue>(await this.endpoint.consistency());
    if (!Array.isArray(value.issues)) {
      throw new ConversationManagerRequestError("体检响应不可用", undefined);
    }
    return value;
  }

  private async repairSession(
    sessionId: string,
    action: SessionRepairAction,
  ): Promise<SessionRepairValue> {
    const value = unwrap<SessionRepairValue>(await this.endpoint.repair({ sessionId, action }));
    if (typeof value.keptEvents !== "number") {
      throw new ConversationManagerRequestError("修复响应不可用", undefined);
    }
    await this.refresh();
    return value;
  }

  private async loadUsage(range: SessionUsageRange): Promise<SessionUsageValue> {
    const value = unwrap<SessionUsageValue>(await this.endpoint.usage({ range }));
    if (
      value.totals === undefined ||
      !Array.isArray(value.buckets) ||
      !Array.isArray(value.sessions)
    ) {
      throw new ConversationManagerRequestError("用量统计响应不可用", undefined);
    }
    return value;
  }

  // 归档状态与标题都可能变：管理动作成功即重拉列表。刷新入口在运行时可能缺席，有就调、没有就跳过。
  private async refresh(): Promise<void> {
    await this.sessions.refresh();
  }
}

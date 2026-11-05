// 对话管理页的动作面：页面只见数据与回调，wire 与下载细节收在这里。
//
// 列表 / 删除 / 导入 / 导出 / 整理 / 用量走 `sessionAdmin` 组；归档与取消归档不重复提供，
// 仍归 `uiWorkspace`（它的 __h 是归档状态的 owner）。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import type {
  SessionOrganizeValue,
  SessionRowsItem,
  SessionRowsRequest,
  SessionUsageRange,
  SessionUsageValue,
} from "@morlay/better-session/endpoint";
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

// 页面从注入面拿到的动作（属性语法：页面解构后直接调用，不绑 this）。
export interface ConversationManagerFace {
  listRows: (query?: SessionRowsRequest) => Promise<ConversationManagerRowsPage>;
  archive: (sessionId: string) => Promise<void>;
  unarchive: (sessionId: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  exportZip: (sessionId: string) => Promise<void>;
  importZip: (file: File) => Promise<string>;
  organizeData: () => Promise<SessionOrganizeValue>;
  loadUsage: (range: SessionUsageRange) => Promise<SessionUsageValue>;
}

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

  private readonly sessions = inject(SessionController);

  readonly face: ConversationManagerFace = {
    listRows: (query) => this.listRows(query ?? {}),
    archive: async (sessionId) => {
      await this.workspace.archiveSession(SessionId(sessionId));
    },
    unarchive: async (sessionId) => {
      await this.workspace.unarchiveSession(SessionId(sessionId));
    },
    remove: (sessionId) => this.remove(sessionId),
    exportZip: (sessionId) => this.exportZip(sessionId),
    importZip: (file) => this.importZip(file),
    organizeData: () => this.organizeData(),
    loadUsage: (range) => this.loadUsage(range),
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

  private async exportZip(sessionId: string): Promise<void> {
    const value = unwrap<{ filename: string; zip: string }>(
      await this.endpoint.export({ sessionId }),
    );
    downloadBlob(zipBlob(value.zip), value.filename);
  }

  private async importZip(file: File): Promise<string> {
    const value = unwrap<{ sessionId: string }>(
      await this.endpoint.import({ zip: await zipBase64(file) }),
    );
    await this.refresh();
    return value.sessionId;
  }

  private async organizeData(): Promise<SessionOrganizeValue> {
    const value = unwrap<SessionOrganizeValue>(await this.endpoint.organize());
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

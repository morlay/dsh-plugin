// `sessionAdmin` 组的宿主实现：会话管理页的六条动作（列表 / 删除 / 导入 / 导出 / 整理 / 用量）。
//
// 源包是六条 HTTP 路由（路径定动作）；remote 里动作由方法名定，错误走 `RemoteResultWire` 的 `error`。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import {
  SessionAdminEndpoint,
  type SessionBulkDeleteRequest,
  type SessionBulkDeleteValue,
  type SessionConsistencyValue,
  type SessionCopyWorkspaceRequest,
  type SessionCopyWorkspaceValue,
  type SessionDeleteRequest,
  type SessionDeleteValue,
  type SessionExportManyItem,
  type SessionExportManyRequest,
  type SessionExportManyValue,
  type SessionExportRequest,
  type SessionExportValue,
  type SessionImportManyRequest,
  type SessionImportManyValue,
  type SessionImportRequest,
  type SessionImportValue,
  type SessionLocateRequest,
  type SessionLocateValue,
  type SessionOrganizeValue,
  type SessionRepairRequest,
  type SessionRepairValue,
  type SessionRowsRequest,
  type SessionRowsValue,
  type SessionUsageRequest,
  type SessionUsageValue,
} from "@morlay/session-rdb/endpoint";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, asRemoteResult, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { asRdbStore } from "../contract/session-rdb-store.contract.ts";
import { SessionAgentControl } from "../contract/session-agent-control.contract.ts";
import { parseUsageRange, resolveUsageSince } from "../data/usage.ts";
import { MAX_IMPORT_ZIP_BYTES } from "../admin/import-export/parse.ts";
import { SessionStoreError } from "../data/errors.ts";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
// 页码上限：offset 由它算出来，一个离谱的页码等于让库把整表扫一遍。
const MAX_PAGE = 10_000;
// base64 比二进制大约 4/3；先按字符数挡一遍，避免为一个必然被拒的包先分配几十 MB。
const MAX_IMPORT_BASE64_CHARS = Math.ceil((MAX_IMPORT_ZIP_BYTES * 4) / 3) + 4;
const USAGE_RANGES = new Set(["day", "week", "7d", "30d", "90d", "all"]);

// zip 的 base64 编码：remote 只走 JSON。
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

@RemoteGroup()
@Injectable()
export class SessionAdminEndpointDefault extends SessionAdminEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly persistence = inject(SessionPersistence);

  private readonly agents = inject.optional(SessionAgentControl);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override async rows(request: SessionRowsRequest) {
    return await asRemoteResult(async (): Promise<SessionRowsValue> => {
      const page =
        Number.isSafeInteger(request.page) && (request.page ?? 0) > 0 ? request.page! : 1;
      if (page > MAX_PAGE) {
        throw new SessionStoreError(
          "SESSION_ROWS_INVALID_PAGE",
          `page ${String(page)} exceeds the supported maximum ${String(MAX_PAGE)}`,
        );
      }
      const requested = request.pageSize;
      const pageSize =
        Number.isSafeInteger(requested) && (requested ?? 0) > 0
          ? Math.min(requested!, MAX_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE;
      const listed = await asRdbStore(this.persistence).listRows({
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.includeSubagents === undefined
          ? {}
          : { includeSubagents: request.includeSubagents }),
        ...(request.updatedAfter === undefined ? {} : { updatedAfter: request.updatedAfter }),
        ...(request.updatedBefore === undefined ? {} : { updatedBefore: request.updatedBefore }),
        ...(request.origin === undefined ? {} : { origin: request.origin }),
        ...(request.archived === undefined ? {} : { archived: request.archived }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return {
        items: listed.items,
        total: listed.total,
        page,
        pageSize,
        ...(listed.searchStage === undefined ? {} : { searchStage: listed.searchStage }),
      };
    });
  }

  override async delete(request: SessionDeleteRequest) {
    return await asRemoteResult(async (): Promise<SessionDeleteValue> => {
      // 三条拒绝理由的码原样带到 wire 上（客户端按它分派，不解析文案）。
      await asRdbStore(this.persistence).deleteSession(request.sessionId);
      return { deleted: request.sessionId };
    });
  }

  override async bulkDelete(request: SessionBulkDeleteRequest) {
    return await asRemoteResult(async (): Promise<SessionBulkDeleteValue> => {
      // 逐条结算：单条的拒绝（未归档 / 运行中 / 不存在）是结果里的码，不是整批失败。
      const result = await asRdbStore(this.persistence).bulkDelete(
        Array.isArray(request.sessionIds) ? request.sessionIds : [],
      );
      return { items: result.items };
    });
  }

  override async import(request: SessionImportRequest) {
    return await asRemoteResult(async (): Promise<SessionImportValue> => {
      // 先按 base64 字符数挡一遍，再解码：否则一个必然被拒的包会先占满宿主内存。
      if (request.zip.length > MAX_IMPORT_BASE64_CHARS) {
        throw new SessionStoreError(
          "SESSION_IMPORT_TOO_LARGE",
          "imported zip exceeds the size limit",
        );
      }
      const zip = fromBase64(request.zip);
      const sessionId = await asRdbStore(this.persistence).importZip(zip, request.sessionId);
      return { sessionId };
    });
  }

  override async export(request: SessionExportRequest) {
    return await asRemoteResult(async (): Promise<SessionExportValue> => {
      const raw = await asRdbStore(this.persistence).readRaw(request.sessionId);
      if (raw === undefined) {
        throw new SessionStoreError(
          "SESSION_NOT_FOUND",
          `session "${request.sessionId}" not found`,
        );
      }
      const zip = await zipSingleFile(raw.filename, raw.content);
      return { filename: `${request.sessionId}.zip`, zip: toBase64(zip) };
    });
  }

  override async copyToWorkspace(request: SessionCopyWorkspaceRequest) {
    return await asRemoteResult(async (): Promise<SessionCopyWorkspaceValue> => {
      // 组合动作（fork + workspace 的 attach）在存储面；端点只转形状。
      return await asRdbStore(this.persistence).copyToWorkspace(
        request.sessionId,
        request.workspaceId,
      );
    });
  }

  override async exportMany(request: SessionExportManyRequest) {
    return await asRemoteResult(async (): Promise<SessionExportManyValue> => {
      // 逐条结算：存储面已经按条折好结果，这里只把每条的内容打成一份单文件 zip。
      const result = await asRdbStore(this.persistence).exportMany(
        Array.isArray(request.sessionIds) ? request.sessionIds : [],
      );
      const items: SessionExportManyItem[] = [];
      for (const item of result.items) {
        if (!item.ok || item.filename === undefined || item.content === undefined) {
          items.push({
            sessionId: item.sessionId,
            ok: false,
            ...(item.code === undefined ? {} : { code: item.code }),
          });
          continue;
        }
        const zip = await zipSingleFile(item.filename, item.content);
        items.push({
          sessionId: item.sessionId,
          ok: true,
          filename: `${item.sessionId}.zip`,
          zip: toBase64(zip),
        });
      }
      return { items };
    });
  }

  override async importMany(request: SessionImportManyRequest) {
    return await asRemoteResult(async (): Promise<SessionImportManyValue> => {
      // 单条的字节上限在存储面的解析里判（逐条带码），这里只负责解码。
      const zips = (Array.isArray(request.zips) ? request.zips : []).map((value) =>
        fromBase64(value),
      );
      const result = await asRdbStore(this.persistence).importMany(zips);
      return { items: result.items };
    });
  }

  override async organize() {
    return await asRemoteResult(async (): Promise<SessionOrganizeValue> => {
      const stoppedAgents = await this.stopRunningAgents();
      const report = await asRdbStore(this.persistence).organize();
      return { stoppedAgents, ...report, vacuumed: true };
    });
  }

  override async locate(request: SessionLocateRequest) {
    return await asRemoteResult(async (): Promise<SessionLocateValue> => {
      // 只有会话身份留在请求上，其余条件原样下推（窗口的合法性由存储面判，端点不重复一套）。
      const { sessionId, ...query } = request;
      return await asRdbStore(this.persistence).locateEvents(sessionId, query);
    });
  }

  override async repair(request: SessionRepairRequest) {
    return await asRemoteResult(async (): Promise<SessionRepairValue> => {
      // 三个修法各自带码：删除走既有守卫（未归档 / 运行中），定位类错误由存储面给。
      return await asRdbStore(this.persistence).repairSession(request.sessionId, request.action);
    });
  }

  override async consistency() {
    return await asRemoteResult(async (): Promise<SessionConsistencyValue> => {
      // 体检只读：报告原样过 wire（不在这里做任何修）。
      const report = await asRdbStore(this.persistence).checkConsistency();
      return { ok: report.ok, checked: report.checked, issues: report.issues };
    });
  }

  override async usage(request: SessionUsageRequest) {
    return await asRemoteResult(async (): Promise<SessionUsageValue> => {
      // 未知范围显式拒绝：静默降级成「全部」会让用户以为看的是本日数据。
      const range = request.range ?? "all";
      if (!USAGE_RANGES.has(range)) {
        throw new SessionStoreError(
          "SESSION_USAGE_INVALID_RANGE",
          `unsupported usage range "${range}"`,
        );
      }
      const since = resolveUsageSince(parseUsageRange(range), Date.now());
      const report = await asRdbStore(this.persistence).usageReport(since);
      return report as unknown as SessionUsageValue;
    });
  }

  // 整理数据要重写事件与统计表，运行中的写路径必须先停下来。
  private async stopRunningAgents(): Promise<number> {
    const running = this.agents?.list() ?? [];
    for (const agent of running) agent.cancel?.({ kind: "user" }, { keepInbox: true });
    await Promise.all(running.map((agent) => agent.whenIdle()));
    return running.length;
  }
}

// 一份日志打成单文件 zip：导出件的形状与导入通道读的 artifact 名一致。
async function zipSingleFile(name: string, content: string): Promise<Uint8Array> {
  const { zip, strToU8 } = await import("fflate");
  return await new Promise<Uint8Array>((resolve, reject) => {
    zip({ [name]: strToU8(content) }, (error, data) => {
      if (error === null) resolve(data);
      else reject(error);
    });
  });
}

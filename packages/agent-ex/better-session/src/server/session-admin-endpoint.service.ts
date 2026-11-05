// `sessionAdmin` 组的宿主实现：会话管理页的六条动作（列表 / 删除 / 导入 / 导出 / 整理 / 用量）。
//
// 源包是六条 HTTP 路由（路径定动作）；remote 里动作由方法名定，错误走 `RemoteResultWire` 的 `error`。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import {
  SessionAdminEndpoint,
  type SessionDeleteRequest,
  type SessionDeleteValue,
  type SessionExportRequest,
  type SessionExportValue,
  type SessionImportRequest,
  type SessionImportValue,
  type SessionOrganizeValue,
  type SessionRowsRequest,
  type SessionRowsValue,
  type SessionUsageRequest,
  type SessionUsageValue,
} from "@morlay/better-session/endpoint";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, asRemoteResult, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { asRdbStore } from "../contract/session-rdb-store.contract.ts";
import { SessionAgentControl } from "../contract/session-agent-control.contract.ts";
import { parseUsageRange, resolveUsageSince } from "../rdb/usage.ts";
import { MAX_IMPORT_ZIP_BYTES } from "../rdb/log-import.ts";
import { SessionDeletionError } from "../rdb/deletion-error.ts";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;

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
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { items: listed.items, total: listed.total, page, pageSize };
    });
  }

  override async delete(request: SessionDeleteRequest) {
    return await asRemoteResult(async (): Promise<SessionDeleteValue> => {
      try {
        await asRdbStore(this.persistence).deleteSession(request.sessionId);
      } catch (error: unknown) {
        // 三条拒绝理由的码原样带到 wire 上（客户端按它分派，不解析文案）。
        throw error instanceof SessionDeletionError
          ? Object.assign(error, { code: error.code })
          : error;
      }
      return { deleted: request.sessionId };
    });
  }

  override async import(request: SessionImportRequest) {
    return await asRemoteResult(async (): Promise<SessionImportValue> => {
      const zip = fromBase64(request.zip);
      if (zip.byteLength > MAX_IMPORT_ZIP_BYTES)
        throw new Error("imported zip exceeds the size limit");
      const sessionId = await asRdbStore(this.persistence).importZip(zip, request.sessionId);
      return { sessionId };
    });
  }

  override async export(request: SessionExportRequest) {
    return await asRemoteResult(async (): Promise<SessionExportValue> => {
      const raw = await asRdbStore(this.persistence).readRaw(request.sessionId);
      if (raw === undefined) throw new Error(`session "${request.sessionId}" not found`);
      const zip = await zipSingleFile(raw.filename, raw.content);
      return { filename: `${request.sessionId}.zip`, zip: toBase64(zip) };
    });
  }

  override async organize() {
    return await asRemoteResult(async (): Promise<SessionOrganizeValue> => {
      const stoppedAgents = await this.stopRunningAgents();
      const report = await asRdbStore(this.persistence).organize();
      return { stoppedAgents, ...report, vacuumed: true };
    });
  }

  override async usage(request: SessionUsageRequest) {
    return await asRemoteResult(async (): Promise<SessionUsageValue> => {
      const since = resolveUsageSince(parseUsageRange(request.range), Date.now());
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

// 导出端点：把会话日志打成 zip 响应体，与导入端点读同一份 artifact。
import { strToU8, zip } from "fflate";
import { inject, Injectable } from "@morlay/zephyr";
import { SessionAdmin, SESSION_EXPORT_PATH } from "@morlay/dsh-storage/admin";
import {
  HttpEndpoint,
  readJsonBody,
  rejectNonPost,
  rejectUnauthorized,
  respondFailure,
  respondJson,
  type WebRoute,
} from "./http-endpoint.ts";

function safeFilename(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function zipBytes(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error === null) resolve(data);
      else reject(error);
    });
  });
}

@Injectable()
export class SessionExportEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_EXPORT_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_EXPORT_PATH,
      handler: async (req, res) => {
        if (rejectUnauthorized(this.trust, req, res)) return;
        if (rejectNonPost(req, res)) return;
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const envelope = body.value as { sessionId?: unknown } | undefined;
        if (typeof envelope?.sessionId !== "string" || envelope.sessionId === "") {
          respondJson(res, 400, { error: "missing sessionId field" });
          return;
        }
        const sessionId = envelope.sessionId;
        try {
          const raw = await this.admin.exportSession(sessionId as never);
          if (raw === undefined) {
            respondJson(res, 404, { error: `session "${sessionId}" not found` });
            return;
          }
          const zipFile = await zipBytes({ [raw.filename]: strToU8(raw.content) });
          res.writeHead(200, {
            "content-type": "application/zip",
            "content-length": String(zipFile.byteLength),
            "content-disposition": `attachment; filename="${safeFilename(sessionId)}.zip"`,
          });
          res.end(Buffer.from(zipFile));
        } catch (error: unknown) {
          respondFailure(res, error, "session export failed");
        }
      },
    };
  }
}

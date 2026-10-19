// 导入端点：zip → artifact → 写入（或覆盖）会话，覆盖前停掉目标会话的运行中 agent。
import { inject, Injectable } from "@morlay/zephyr";
import {
  MAX_IMPORT_ZIP_BYTES,
  SessionAdmin,
  SESSION_IMPORT_PATH,
  parseImportZip,
} from "@morlay/dsh-storage/admin";
import {
  HttpEndpoint,
  readJsonBody,
  rejectUnauthorized,
  respondFailure,
  respondJson,
  type WebRoute,
} from "./http-endpoint.ts";

@Injectable()
export class SessionImportEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_IMPORT_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_IMPORT_PATH,
      handler: async (req, res) => {
        if (rejectUnauthorized(this.trust, req, res)) return;
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const envelope = body.value as { zip?: unknown; sessionId?: unknown } | undefined;
        if (typeof envelope?.zip !== "string" || envelope.zip === "") {
          respondJson(res, 400, { error: "missing zip field" });
          return;
        }
        if (
          envelope.sessionId !== undefined &&
          (typeof envelope.sessionId !== "string" || envelope.sessionId === "")
        ) {
          respondJson(res, 400, { error: "sessionId must be a non-empty string" });
          return;
        }
        const zip = Buffer.from(envelope.zip, "base64");
        if (zip.byteLength > MAX_IMPORT_ZIP_BYTES) {
          respondJson(res, 413, { error: "imported zip exceeds the size limit" });
          return;
        }
        let imported: Awaited<ReturnType<typeof parseImportZip>>;
        try {
          imported = await parseImportZip(zip);
        } catch (error: unknown) {
          respondJson(res, 400, {
            error: error instanceof Error ? error.message : "imported zip is invalid",
          });
          return;
        }
        const targetId =
          typeof envelope.sessionId === "string" ? (envelope.sessionId as never) : undefined;
        try {
          const id = await this.admin.importSession(imported, targetId);
          respondJson(res, 200, { sessionId: id });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (targetId !== undefined && /not found/i.test(message)) {
            respondJson(res, 404, { error: `session "${targetId}" not found` });
            return;
          }
          respondFailure(res, error, "import failed");
        }
      },
    };
  }
}

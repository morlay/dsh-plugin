// 删除端点：只能删已归档的会话，运行中的会话拒绝（先归档再删）。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionAdmin, SessionDeletionError, SESSION_DELETE_PATH } from "@morlay/dsh-storage/admin";
import {
  HttpEndpoint,
  readJsonBody,
  rejectNonPost,
  rejectUnauthorized,
  respondFailure,
  respondJson,
  type WebRoute,
} from "./http-endpoint.ts";

const STATUS_OF_DELETION_ERROR: Record<SessionDeletionError["code"], number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_NOT_ARCHIVED: 409,
  SESSION_LIVE: 409,
};

@Injectable()
export class SessionDeletionEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_DELETE_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_DELETE_PATH,
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
        try {
          await this.admin.deleteSession(envelope.sessionId as never);
        } catch (error: unknown) {
          if (error instanceof SessionDeletionError) {
            respondJson(res, STATUS_OF_DELETION_ERROR[error.code], {
              error: error.message,
              code: error.code,
            });
            return;
          }
          respondFailure(res, error, "session deletion failed");
          return;
        }
        respondJson(res, 200, { deleted: envelope.sessionId });
      },
    };
  }
}

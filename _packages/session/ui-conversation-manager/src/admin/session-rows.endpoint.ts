// 管理面的会话列表端点（`/rows`）：完整语料（含归档）+ 标题 + 最后活动时间。
import { inject, Injectable } from "@morlay/zephyr";
import { SESSION_ROWS_PATH, SessionAdmin } from "@morlay/session-rdb/admin";
import {
  HttpEndpoint,
  readJsonBody,
  rejectNonPost,
  rejectUnauthorized,
  respondFailure,
  respondJson,
  type WebRoute,
} from "./http-endpoint.ts";

@Injectable()
export class SessionRowsEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_ROWS_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_ROWS_PATH,
      handler: async (req, res) => {
        if (rejectUnauthorized(this.trust, req, res)) return;
        if (rejectNonPost(req, res)) return;
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        try {
          respondJson(res, 200, await this.admin.listRows((body.value ?? {}) as never));
        } catch (error: unknown) {
          respondFailure(res, error, "session rows failed");
        }
      },
    };
  }
}

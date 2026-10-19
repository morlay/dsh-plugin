// GC 端点：停 agent → 回收孤儿会话 / 事件行 → VACUUM，一次请求完成。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionAdmin, SESSION_GC_PATH } from "@morlay/session-rdb/admin";
import {
  HttpEndpoint,
  rejectNonPost,
  rejectUnauthorized,
  respondFailure,
  respondJson,
  type WebRoute,
} from "./http-endpoint.ts";

@Injectable()
export class SessionGcEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_GC_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_GC_PATH,
      handler: async (req, res) => {
        if (rejectUnauthorized(this.trust, req, res)) return;
        if (rejectNonPost(req, res)) return;
        try {
          const result = await this.admin.gc();
          respondJson(res, 200, { ...result, vacuumed: true });
        } catch (error: unknown) {
          respondFailure(res, error, "gc failed");
        }
      },
    };
  }
}

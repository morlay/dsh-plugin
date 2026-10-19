// 用量统计端点：总览（含 subagent 拆分）、按天 × 模型的桶与按会话的行。
import { inject, Injectable } from "@morlay/zephyr";
import {
  SESSION_USAGE_PATH,
  SessionAdmin,
  parseUsageRange,
  resolveUsageSince,
} from "@morlay/session-rdb/admin";
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
export class SessionUsageEndpoint extends HttpEndpoint {
  admin = inject(SessionAdmin);

  protected readonly routeLabel = `session-rdb: ${SESSION_USAGE_PATH} route`;

  protected route(): WebRoute {
    return {
      kind: "exact",
      path: SESSION_USAGE_PATH,
      handler: async (req, res) => {
        if (rejectUnauthorized(this.trust, req, res)) return;
        if (rejectNonPost(req, res)) return;
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const envelope = (body.value ?? {}) as { range?: unknown };
        try {
          respondJson(res, 200, await this.admin.usage(resolveUsageSince(parseUsageRange(envelope.range), Date.now())));
        } catch (error: unknown) {
          respondFailure(res, error, "usage report failed");
        }
      },
    };
  }
}

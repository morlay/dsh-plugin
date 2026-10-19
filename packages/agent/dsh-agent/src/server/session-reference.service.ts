// `sessionReferenceResolver/candidates` 的宿主面：上游 `SessionReferenceResolver`（`fromCordis` 接管）+
// 一条 wire 端点。
//
// 上游 `static inject = ['sessionQuery']`（`vendor/.../context/session-reference/src/index.ts:89`），
// `@Remote('candidates') remoteExportCandidates(agent, query, signal)`（同文件 `:281`）。
// 本行只做两件事：把 `SessionQuery` 交给它的 `mount`；把「wire 上的 `SessionId` → `Agent`」解析好再转发。
import SessionReferenceResolver from "@deepseek-ai/dsh-session-reference";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { fromCordis } from "@morlay/zephyr/compat";
import { asRemoteResult } from "@morlay/zephyr-app";
import { SessionQuery } from "@morlay/dsh-session";
import { AgentDirectory } from "../contract/agent-directory.contract.ts";

/** 上游 `SessionReferenceResolver` 里本行要转发的成员（形状直接取上游）。 */
type SessionReferenceFace = Pick<SessionReferenceResolver, "remoteExportCandidates">;

/**
 * `providerInstance` 在上游适配面里的类型是 `object | undefined`：按运行时校验收窄。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns `remoteExportCandidates` 是函数时是真。
 */
function isSessionReferenceFace(value: unknown): value is SessionReferenceFace {
  return (
    value !== null &&
    typeof value === "object" &&
    "remoteExportCandidates" in value &&
    typeof value.remoteExportCandidates === "function"
  );
}

/**
 * `maxReferenceBytes`：上游 schema 里是**必填**（`z.number().step(1).min(1)`，无默认），
 * 由装配面给一个确定的部署值。8 MiB 与上游 web-app bundle 的会话引用上限同一量级：
 * 引用进上下文的字节预算，超过就不再引用更多会话。
 */
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

@Injectable()
export class SessionReferenceDefault extends fromCordis(SessionReferenceResolver) {
  private readonly sessionQuery = inject(SessionQuery);

  private readonly agents = inject(AgentDirectory);

  private readonly handlers = inject(RemoteHandlers);

  protected override async onInit(ctx: Context): Promise<void> {
    // 配置走 `mount` 的第二个参数：上游 `Config` 在 `mount` 里按 schema 归一化（`maxReferenceBytes` 必填）。
    await this.mount(ctx, { maxReferenceBytes: MAX_REFERENCE_BYTES }, { sessionQuery: this.sessionQuery });
    const resolver = this.providerInstance;
    if (resolver === undefined || !isSessionReferenceFace(resolver)) {
      throw new Error("sessionReferenceResolver: 上游实例缺少 remoteExportCandidates");
    }
    // wire 上的命名参数（我们的客户端发 descriptor 的 `name`：`agent` / `query`）。
    this.handlers.register("sessionReferenceResolver/candidates", async (args) =>
      asRemoteResult(async () => {
        const agent = this.agents.get(SessionId(String(args.agent)));
        if (agent === undefined) throw new Error(`sessionReferenceResolver: 会话 "${String(args.agent)}" 没有 agent`);
        return await resolver.remoteExportCandidates(
          agent,
          typeof args.query === "string" ? args.query : "",
          new AbortController().signal,
        );
      }),
    );
  }
}

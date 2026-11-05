// `skills` 组的宿主实现：契约是 `endpoint/skill-endpoint.ts`。
// 上游 `sessionSkillCatalog` 由装配面提供（真机是 `provideApiSession()` 那行装的 `SessionController`
// 内部就 new 了它）；只装技能域的测试显式加 `SkillCatalogRow`。wire 注册走 `registerRemoteGroup`。
import { SessionSkillCatalog } from "@deepseek-ai/dsh-api-session-controller";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SkillCatalogHost } from "../skill-catalog.row.ts";
import { inject, type Context, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import {
  asRemoteResult,
  registerRemoteGroup,
  RemoteGroup,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";
import {
  SkillEndpoint,
  type SkillListRequest,
  type SkillListValue,
} from "../endpoint/skill-endpoint.ts";

/** `skills` 组的宿主实现（组名沿契约基类取）。 */
@RemoteGroup()
export class SkillEndpointDefault extends SkillEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /** 适配行在场时（只装技能域的拓扑）直接用它的契约面。 */
  private readonly host = inject.optional(SkillCatalogHost);

  private stop: () => void = () => {};

  /** 行 ctx：调用时按名字取上游实例，装配顺序因此不影响。 */
  private ctx: Context | undefined;

  onInit(ctx: Context): void {
    this.ctx = ctx;
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async list(request: SkillListRequest): Promise<RemoteResultWire<SkillListValue>> {
    return await asRemoteResult(
      async () =>
        await this.catalog().list(
          { sessionId: SessionId(request.sessionId) },
          new AbortController().signal,
        ),
    );
  }

  /**
   * 取上游实例：调用时读，谁装、何时装都不影响。
   * @returns 上游 `SessionSkillCatalog`。
   */
  private catalog(): SessionSkillCatalog {
    const instance =
      this.host ??
      (this.ctx as unknown as { get(name: string, strict?: boolean): unknown } | undefined)?.get(
        "sessionSkillCatalog",
        false,
      );
    // `ctx.get` 返回的是 cordis 的 traceable Proxy：`instanceof` 会失败，按存在性判断。
    if (instance === undefined) {
      throw new Error(
        "skills/list：装配面没有提供上游 `sessionSkillCatalog`（`provideApiSession()` 或 `SkillCatalogRow`）",
      );
    }
    return instance as SessionSkillCatalog;
  }
}

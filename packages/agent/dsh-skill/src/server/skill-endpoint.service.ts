// `skills` 组的宿主实现：契约是 `endpoint/skill-endpoint.ts`，上游实例由适配行
// （`skill-catalog.row.ts`）提供。wire 注册走 `registerRemoteGroup`——不手写 handler 名。
import { SessionSkillCatalog } from "@deepseek-ai/dsh-api-session-controller";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult, registerRemoteGroup, RemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import { SkillCatalogHost } from "../skill-catalog.row.ts";
import {
  SkillEndpoint,
  type SkillListRequest,
  type SkillListValue,
} from "../endpoint/skill-endpoint.ts";

/** `skills` 组的宿主实现（组名沿契约基类取）。 */
@RemoteGroup()
export class SkillEndpointDefault extends SkillEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /** 适配行发布的契约面就是上游 `SessionSkillCatalog` 实例。 */
  private readonly host = inject(SkillCatalogHost);

  private stop: () => void = () => {};

  onInit(): void {
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async list(request: SkillListRequest): Promise<RemoteResultWire<SkillListValue>> {
    return await asRemoteResult(async () => await this.catalog().list({ sessionId: SessionId(request.sessionId) }, new AbortController().signal));
  }

  private catalog(): SessionSkillCatalog {
    const instance = this.host;
    if (!(instance instanceof SessionSkillCatalog)) {
      throw new Error("skills/list: 契约面不是上游 SessionSkillCatalog 实例");
    }
    return instance;
  }
}

// `subagents` 这一组的**宿主实现**：继承 `endpoint/` 的契约类，方法体里转发到上游 `SubagentRuntime`
// （本包的 `SubagentRegistryDefault` 已经把那个实例挂在 `SubagentRegistry` 上，这里不重复 mount）。
//
// 组名从契约类继承（`@RemoteGroup()` 不写名字，`remoteGroupNameOf` 沿原型链取），
// 端点名只有一个 home：`endpoint/subagents-endpoint.ts`。
import { SessionId } from "@morlay/dsh-session/endpoint";
import type { SubagentPromptRequest as UpstreamPromptRequest } from "@morlay/dsh-subagent/server";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { asRemoteResult } from "@morlay/zephyr-app";
import { SubagentRegistry } from "../contract/subagent-registry.contract.ts";
import {
  SubagentsEndpoint,
  type SubagentInterruptByParentRequest,
  type SubagentInterruptByParentValue,
  type SubagentPromptRequest,
  type SubagentPromptValue,
} from "../endpoint/subagents-endpoint.ts";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";

/** `subagents` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class SubagentsEndpointDefault extends SubagentsEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly subagents = inject(SubagentRegistry);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override async prompt(
    request: SubagentPromptRequest,
  ): Promise<RemoteResultWire<SubagentPromptValue>> {
    return await asRemoteResult(async () => {
      // wire 上是裸字符串，上游要品牌身份：在边界铸一次（会话身份与请求身份都在这里转换）。
      // `requestId` 的品牌只由上游定义（`SubagentPromptRequestId = Branded<'session-request-id'>`，
      // 没有导出的工厂），所以整条请求按上游形状交给它——这一处 `as` 是 wire → 上游类型的边界转换。
      const upstream = {
        ...request,
        parentSessionId: SessionId(request.parentSessionId),
        childSessionId: SessionId(request.childSessionId),
      } as UpstreamPromptRequest;
      // unary 的 wire 不带信号：上游 `prompt(request, signal)` 要一个（它随激活一起取消）。
      return await this.subagents.prompt(upstream, new AbortController().signal);
    });
  }

  override async interruptByParent(
    request: SubagentInterruptByParentRequest,
  ): Promise<RemoteResultWire<SubagentInterruptByParentValue>> {
    return await asRemoteResult(async () => {
      if (request.mode !== "continuable") {
        throw new Error(`subagents/interruptByParent: mode 必须是 "continuable"（收到 ${String(request.mode)}）`);
      }
      return this.subagents.interruptByParent(
        SessionId(request.childSessionId),
        SessionId(request.parentSessionId),
        request.mode,
      );
    });
  }
}

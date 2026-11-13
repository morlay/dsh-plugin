// `subagents` 这一组的**宿主实现**：继承 `endpoint/` 的契约类，方法体里转发到上游 `SubagentRuntime`
// （本包的 `SubagentRegistryDefault` 已经把那个实例挂在 `SubagentRegistry` 上，这里不重复 mount）。
//
// 组名从契约类继承（`@RemoteGroup()` 不写名字，`remoteGroupNameOf` 沿原型链取），
// 端点名只有一个 home：`endpoint/subagents-endpoint.ts`。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { asRemoteResult } from "@morlay/zephyr-app";
import { SubagentRegistry } from "@morlay/dsh-agent";
import {
  SubagentsEndpoint,
  type SubagentInterruptByUserRequest,
  type SubagentInterruptByUserValue,
  type SubagentPromptRequest,
  type SubagentPromptValue,
} from "@morlay/dsh-agent/endpoint";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import type {
  SubagentPromptRequest as UpstreamPromptRequest,
  SubagentPromptRequestId,
} from "@morlay/dsh-agent/contract";

/**
 * wire 上的裸字符串 → 上游的请求身份。
 * @param value - wire 上的 `requestId`（调用方铸好的消息身份）。
 * @returns 带 `session-request-id` 品牌的同一字符串。
 */
function asPromptRequestId(value: string): SubagentPromptRequestId {
  return value as SubagentPromptRequestId;
}

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
      // wire 上是裸字符串，上游要品牌身份：在边界逐字段铸一次（会话身份与请求身份都在这里转换）。
      // `requestId` 的品牌只由上游定义（`SubagentPromptRequestId = Branded<'session-request-id'>`，
      // 没有导出的工厂），所以这一处用一个具名的品牌铸造函数，而不是整条对象 `as`。
      // 逐字段展开而不是 `...request`：`exactOptionalPropertyTypes` 下，wire 上"可能有 undefined"
      // 的可选字段不能直接摊进上游的 `?` 字段。
      const upstream: UpstreamPromptRequest = {
        requestId: asPromptRequestId(request.requestId),
        childSessionId: SessionId(request.childSessionId),
        delivery: request.delivery,
        content: request.content,
        ...(request.clientTimeZone === undefined ? {} : { clientTimeZone: request.clientTimeZone }),
      };
      // unary 的 wire 不带信号：上游 `prompt(request, signal)` 要一个（它随激活一起取消）。
      return await this.subagents.prompt(upstream, new AbortController().signal);
    });
  }

  override async interruptByUser(
    request: SubagentInterruptByUserRequest,
  ): Promise<RemoteResultWire<SubagentInterruptByUserValue>> {
    return await asRemoteResult(async () => {
      // 上游只收一个品牌化的子会话身份；权限判定（user 侧）在它内部做。
      return this.subagents.interruptByUser(SessionId(request.childSessionId));
    });
  }
}

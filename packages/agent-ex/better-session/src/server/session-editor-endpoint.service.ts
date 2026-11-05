// `sessionEditor` 组的宿主实现：把编辑契约接到 wire 上。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里只写业务转发与错误折叠。
import { SessionId } from "@morlay/dsh-session/contract";
import {
  SessionEditorEndpoint,
  type SessionEditRequest,
  type SessionEditorValue,
  type SessionForkRequest,
  type SessionRecallRequest,
  type SessionRerollRequest,
  type SessionRetryRequest,
  type SessionRewindRequest,
} from "@morlay/better-session/endpoint";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import {
  RemoteGroup,
  asRemoteResult,
  registerRemoteGroup,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";
import { SessionEditor } from "../contract/session-editor.contract.ts";
import { SessionBranchError } from "../endpoint/branch.ts";

// 契约面上的 id 是 wire 的裸字符串，进业务前在这一处铸成 branded 身份。
function idOf(value: string): SessionId {
  return SessionId(value);
}

@RemoteGroup()
@Injectable()
export class SessionEditorEndpointDefault extends SessionEditorEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly editor = inject(SessionEditor);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override async edit(request: SessionEditRequest) {
    return await asRemoteResult(() =>
      this.editor.edit({ ...request, sessionId: idOf(request.sessionId) }),
    );
  }

  override async reroll(request: SessionRerollRequest) {
    return await asRemoteResult(() =>
      this.editor.reroll({ ...request, sessionId: idOf(request.sessionId) }),
    );
  }

  override async retry(request: SessionRetryRequest) {
    return await asRemoteResult(() =>
      this.editor.retry({ ...request, sessionId: idOf(request.sessionId) }),
    );
  }

  override async rewind(
    request: SessionRewindRequest,
  ): Promise<RemoteResultWire<SessionEditorValue>> {
    return await asRemoteResult(async () => {
      await this.editor.rewind(idOf(request.sessionId), request.toBoundary);
      return { sessionId: request.sessionId, queuedTurns: 0 } satisfies SessionEditorValue;
    });
  }

  override async recall(request: SessionRecallRequest) {
    return await asRemoteResult(() =>
      this.editor.recall({ ...request, sessionId: idOf(request.sessionId) }),
    );
  }

  override async fork(request: SessionForkRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    return await asRemoteResult(async () => {
      const childId = await this.editor.fork(
        idOf(request.sessionId),
        request.atSeq,
        request.childSessionId === undefined ? undefined : idOf(request.childSessionId),
      );
      return { sessionId: childId, queuedTurns: 0 } satisfies SessionEditorValue;
    });
  }
}

// 分支错误的码带上 wire 的失败码（客户端按它分派）。
export function failureCodeOf(error: unknown): string | undefined {
  return error instanceof SessionBranchError ? error.code : undefined;
}

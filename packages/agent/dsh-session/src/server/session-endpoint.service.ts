// `session` 组的宿主实现：15 个端点的 wire 面。`list` / `create` / `page` / `follow` 是**目录职责**，
// 转发到 `SessionControllerHost`（会话目录）；其余 11 个（`rename` / `selectModel` / `fork` / `search` /
// `modelCatalog` / `initializeDefaultModel` / `canOpenWorkspacePath` / `prompt` / `cancel` / `updateQueue` /
// `workspacePathApplications`）转发到 `RemoteSessionHost` 契约面（上游 `SessionController` 实例）。
//
// 与 `SessionControllerHost` 的分工：那个管宿主表（`list`/`get`/`create`/`page`/`follow`，真 store +
// persistence + workspace 挂载），这里只做「契约 → 上游方法」的显式解包与投影。两个类各管一件事。
//
// 每个方法都包一层 `asRemoteResult`：客户端（上游 `ui-session` 一族）读 `response.ok` / `response.error`。
import { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { FileUploadReceiptId } from "@deepseek-ai/dsh-client-file-upload/types";
import type { PromptContentPart } from "@deepseek-ai/dsh-api-session-controller";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import type { MessageId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult, RemoteGroup, registerRemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import {
  SessionEndpoint,
  type SessionForkRequest,
  type SessionForkValue,
  type SessionModelCatalogValue,
  type SessionAcceptedValue,
  type SessionCancelRequest,
  type SessionPromptContentPart,
  type SessionPromptRequest,
  type SessionPromptValue,
  type SessionListValue,
  type SessionCreateRequest,
  type SessionCreateValue,
  type SessionPageRequest,
  type SessionPageValue,
  type SessionFollowRequest,
  type SessionFollowFrame,
  type SessionRenameRequest,
  type SessionUpdateQueueRequest,
  type SessionQueueAction,
  type SessionRenameValue,
  type SessionSearchRequest,
  type SessionSearchValue,
  type SessionSelectModelRequest,
  type SessionSelectModelValue,
  type SessionWorkspacePathApplication,
  type SessionWorkspacePathApplicationsRequest,
} from "../endpoint/session-endpoint.ts";
import { RemoteSessionHost } from "./session-controller.row.ts";
import { SessionControllerHost } from "./session-controller.host.ts";

/** `session` 组的宿主实现（组名从契约继承，`@RemoteGroup()` 不写名字）。 */
@RemoteGroup()
export class SessionEndpointDefault extends SessionEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /**
   * 行发布的契约面就是上游 `SessionController` 实例（`fromCordis` 的 `contractFaceOf`），
   * 所以按契约注入、用 `instanceof` 收窄——不绕行实例。
   */
  private readonly host = inject(RemoteSessionHost);

  /**
   * 会话目录（宿主表）：列表派生、建档（含 workspace 挂载与 `api-session/added` 推送）、翻页、跟随窗口。
   * 这些是**目录职责**，不转发上游 `SessionController`；`session/*` 的端点名与形状归本契约声明。
   */
  private readonly catalog = inject(SessionControllerHost);

  private stop = (): void => {};

  onInit(): void {
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async list(): Promise<SessionListValue> {
    return this.catalog.snapshotForRemote();
  }

  override async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return await this.catalog.createSession(request);
  }

  override async page(request: SessionPageRequest): Promise<SessionPageValue> {
    // 不存在的会话不能静默回空页：读窗口的调用方会把它当成「这会话就是空的」。
    if (this.catalog.get(request.sessionId) === undefined) {
      throw new Error(`session/page: no such session "${request.sessionId}"`);
    }
    // 历史窗口还没有实现（持久化里的事件尚未接进来）：已知缺口，存在会话先给空页。
    return { records: [], hasMore: false };
  }

  override follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.catalog.follow(request, signal);
  }

  override async rename(request: SessionRenameRequest): Promise<RemoteResultWire<SessionRenameValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().rename({
        sessionId: SessionId(request.sessionId),
        title: request.title,
      });
      return { title: value.title, seq: value.seq };
    });
  }

  override async selectModel(
    request: SessionSelectModelRequest,
  ): Promise<RemoteResultWire<SessionSelectModelValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().selectModel({
        sessionId: SessionId(request.sessionId),
        provider: request.provider,
        model: request.model,
        ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      });
      return {
        selected: {
          provider: value.selected.provider,
          model: value.selected.model,
          ...(value.selected.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: value.selected.reasoningEffort }),
        },
      };
    });
  }

  override async fork(request: SessionForkRequest): Promise<RemoteResultWire<SessionForkValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().fork({
        sessionId: SessionId(request.sessionId),
        ...(request.atSeq === undefined ? {} : { atSeq: request.atSeq }),
        ...(request.allowMigration === undefined ? {} : { allowMigration: request.allowMigration }),
      });
      return { sessionId: value.sessionId };
    });
  }

  override async search(request: SessionSearchRequest): Promise<RemoteResultWire<SessionSearchValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().search({ query: request.query }, new AbortController().signal);
      return {
        items: value.items.map((item) => ({ sessionId: item.sessionId, snippet: item.snippet })),
        hasMore: value.hasMore,
      };
    });
  }

  override async modelCatalog(): Promise<RemoteResultWire<SessionModelCatalogValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().modelCatalog();
      return {
        default: {
          provider: value.default.provider,
          model: value.default.model,
          ...(value.default.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: value.default.reasoningEffort }),
        },
        routableProviders: [...value.routableProviders],
        groups: value.groups.map((group) => ({
          id: group.id,
          name: group.name,
          models: group.models.map((model) => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
            ...(model.reasoning === undefined
              ? {}
              : {
                  reasoning: {
                    efforts: model.reasoning.efforts.map((effort) => ({
                      id: effort.id,
                      name: effort.name,
                      ...(effort.description === undefined ? {} : { description: effort.description }),
                    })),
                    ...(model.reasoning.defaultEffort === undefined
                      ? {}
                      : { defaultEffort: model.reasoning.defaultEffort }),
                  },
                }),
            ...(model.badge === undefined
              ? {}
              : { badge: { text: model.badge.text, tone: model.badge.tone } }),
          })),
        })),
        failures: value.failures.map((failure) => ({
          id: failure.id,
          name: failure.name,
          message: failure.message,
        })),
      };
    });
  }

  override async initializeDefaultModel(): Promise<RemoteResultWire<void>> {
    return await asRemoteResult(async () => {
      await this.session().initializeDefaultModel();
    });
  }

  override async canOpenWorkspacePath(): Promise<RemoteResultWire<boolean>> {
    return await asRemoteResult(async () => this.session().canOpenWorkspacePath());
  }

  override async prompt(request: SessionPromptRequest): Promise<RemoteResultWire<SessionPromptValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().prompt(
        {
          requestId: brandString<SessionRequestId>(request.requestId),
          sessionId: SessionId(request.sessionId),
          mode: request.mode,
          content: request.content.map(promptPartOf),
          ...(request.clientTimeZone === undefined ? {} : { clientTimeZone: request.clientTimeZone }),
        },
        new AbortController().signal,
      );
      return { accepted: value.accepted };
    });
  }

  override async cancel(request: SessionCancelRequest): Promise<RemoteResultWire<SessionAcceptedValue>> {
    return await asRemoteResult(async () => {
      const value = this.session().cancel({ sessionId: SessionId(request.sessionId) });
      return { accepted: value.accepted };
    });
  }

  override async updateQueue(
    request: SessionUpdateQueueRequest,
  ): Promise<RemoteResultWire<SessionAcceptedValue>> {
    return await asRemoteResult(async () => {
      const value = await this.session().updateQueue({
        sessionId: SessionId(request.sessionId),
        itemId: brandString<MessageId>(request.itemId),
        action: queueActionOf(request.action),
      });
      return { accepted: value.accepted };
    });
  }

  override async workspacePathApplications(
    request: SessionWorkspacePathApplicationsRequest,
  ): Promise<RemoteResultWire<readonly SessionWorkspacePathApplication[]>> {
    return await asRemoteResult(async () => {
      const applications = await this.session().workspacePathApplications(
        { path: request.path },
        new AbortController().signal,
      );
      return applications.map((application) => ({
        id: application.id,
        name: application.name,
        default: application.default,
        icon: application.icon,
      }));
    });
  }

  private session(): SessionController {
    const instance = this.host;
    if (!(instance instanceof SessionController)) {
      throw new Error("session: 契约面不是上游 SessionController 实例");
    }
    return instance;
  }
}

/**
 * 把 wire 的内容段映射成上游 `PromptContentPart`（品牌字段在这一层铸）。
 * @param part - 契约里的内容段。
 * @returns 上游要求的形状。
 */
function promptPartOf(part: SessionPromptContentPart): PromptContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return {
        type: "image",
        mediaType: part.mediaType,
        data: part.data,
        ...(part.name === undefined ? {} : { name: part.name }),
      };
    case "file":
      return { type: "file", receiptId: brandString<FileUploadReceiptId>(part.receiptId) };
  }
}

/**
 * 把 wire 的队列动作映射成上游 `QueueAction`。
 * @param action - 契约里的动作。
 * @returns 上游要求的形状。
 */
function queueActionOf(action: SessionQueueAction): Parameters<SessionController["updateQueue"]>[0]["action"] {
  switch (action.kind) {
    case "edit":
      return { kind: "edit", content: action.content.map((block) => ({ type: "text", text: block.text })) };
    case "remove":
      return { kind: "remove" };
    case "steer":
      return { kind: "steer" };
  }
}

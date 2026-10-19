// `schedule/list` 的宿主实现：上游 `ScheduleService`（`TypertRemoteService`，namespace `schedule`）经 `fromCordis` 接管。
//
// 上游是完整服务（storage domain 里的任务表、投递历史、运行时都归它），这里只把它接到我们已装的四个
// 服务上，并把 `schedule/list` 注册到宿主 wire（`RemoteHandlers`，与 `session`、`skills` 同一套）。
import {
  ScheduleService,
  type ScheduleDeleteRequest,
  type ScheduleDeleteResult,
  type ScheduleDeliveryHistoryRequest,
  type ScheduleDeliveryHistoryResult,
  type ScheduleDeleteInactiveResult,
  type ScheduleCatalogEntry,
  type ScheduleListRequest,
  type ScheduleRecord,
  type ScheduleUpdateRequest,
  type ScheduleUpdateResult,
} from "@deepseek-ai/dsh-schedule";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { StorageDomain } from "@morlay/dsh-storage";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { fromCordis } from "@morlay/zephyr/compat";
import { asRemoteResult, type RemoteResultWire } from "@morlay/zephyr-app";
import { SessionStore } from "../contract/session.contract.ts";

/**
 * wire 端点名（上游 descriptor：`namespace: 'schedule'`）。
 *
 * 六个都逐条实现：每个的 wire 参数名与返回投影按它自己的 descriptor
 * （`vendor/.../schedule/schedule/lib/typert.client.ts:331-441`）。
 */
const SCHEDULE_LIST_ENDPOINT = "schedule/list";
const SCHEDULE_CATALOG_ENDPOINT = "schedule/catalog";
const SCHEDULE_HISTORY_ENDPOINT = "schedule/history";
const SCHEDULE_DELETE_ENDPOINT = "schedule/delete";
const SCHEDULE_DELETE_INACTIVE_ENDPOINT = "schedule/deleteInactive";
const SCHEDULE_UPDATE_ENDPOINT = "schedule/update";

/**
 * 取 `schedule/list` 的命名参数（wire 上是 `{ request: { sessionId } }`）。
 * @param args - 宿主 handler 收到的命名参数。
 * @returns 品牌化后的请求。
 */
function scheduleListRequestOf(args: Readonly<Record<string, unknown>>): ScheduleListRequest {
  const request = args["request"];
  if (typeof request !== "object" || request === null || !("sessionId" in request)) {
    throw new Error("schedule/list: 缺少 request.sessionId");
  }
  const sessionId = request.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("schedule/list: request.sessionId 必须是非空字符串");
  }
  return { sessionId: SessionId(sessionId) };
}

/**
 * `{ request }` 形状的命名参数（`schedule` 的 history / delete / update 都是这一个形状）。
 * @param args - 宿主 handler 收到的命名参数。
 * @param endpoint - 端点名（只用于报错）。
 * @returns 品牌化后的请求（字段校验交给上游 zod codec）。
 */
function requestOf<T>(args: Readonly<Record<string, unknown>>, endpoint: string): T {
  const request = args["request"];
  if (typeof request !== "object" || request === null) {
    throw new Error(`${endpoint}: 缺少 request`);
  }
  return request as T;
}

/** `schedule/list` 的宿主行。 */
@Injectable()
export class ScheduleRow extends fromCordis(ScheduleService, ScheduleService) {
  private readonly agents = inject(AgentDirectory);

  private readonly sessions = inject(SessionStore);

  private readonly storageDomain = inject(StorageDomain);

  private readonly sessionPersistence = inject(SessionPersistence);

  private readonly handlers = inject(RemoteHandlers);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessions: this.sessions,
      storageDomain: this.storageDomain,
      sessionPersistence: this.sessionPersistence,
    });
    this.handlers.register(SCHEDULE_LIST_ENDPOINT, async (args) =>
      await asRemoteResult(async () => await this.schedule().list(scheduleListRequestOf(args))));
    // 上游 `catalog()` / `deleteInactive()` 没有参数（descriptor 里没有 `parameters`）。
    this.handlers.register(SCHEDULE_CATALOG_ENDPOINT, async () =>
      await asRemoteResult<readonly ScheduleCatalogEntry[]>(async () => await this.schedule().catalog()));
    this.handlers.register(SCHEDULE_DELETE_INACTIVE_ENDPOINT, async () =>
      await asRemoteResult<ScheduleDeleteInactiveResult>(async () => await this.schedule().deleteInactive()));
    this.handlers.register(SCHEDULE_HISTORY_ENDPOINT, async (args) =>
      await asRemoteResult<ScheduleDeliveryHistoryResult>(async () =>
        await this.schedule().history(requestOf<ScheduleDeliveryHistoryRequest>(args, SCHEDULE_HISTORY_ENDPOINT))));
    // unary 的 wire 不带信号：上游这两个方法接一个可选的 `AbortSignal`。
    this.handlers.register(SCHEDULE_DELETE_ENDPOINT, async (args) =>
      await asRemoteResult<ScheduleDeleteResult>(async () =>
        await this.schedule().delete(
          requestOf<ScheduleDeleteRequest>(args, SCHEDULE_DELETE_ENDPOINT),
          new AbortController().signal,
        )));
    this.handlers.register(SCHEDULE_UPDATE_ENDPOINT, async (args) =>
      await asRemoteResult<ScheduleUpdateResult>(async () =>
        await this.schedule().update(
          requestOf<ScheduleUpdateRequest>(args, SCHEDULE_UPDATE_ENDPOINT),
          new AbortController().signal,
        )));
  }

  private schedule(): ScheduleService {
    const instance = this.providerInstance;
    if (!(instance instanceof ScheduleService)) {
      throw new Error("schedule/list: ScheduleService 行没有上游实例");
    }
    return instance;
  }
}

/** 供消费方断言端点返回类型用（与 wire 面同形）。 */
export type ScheduleListResult = RemoteResultWire<readonly ScheduleRecord[]>;

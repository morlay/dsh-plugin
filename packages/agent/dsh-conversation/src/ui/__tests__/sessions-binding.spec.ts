// `sessions` 行的**浏览器侧闭环**：目录快照 + `binding()` 的形状。
//
// 咬住的判据是「权限 chip 能不能发」那条链：上游 `ui-permission-presets` 的 chip 走
//
//   sessions.binding(sessionId)?.session.command('/permission <preset>')
//
// 缺 `binding` 或 `session.command` 时它会抛错，而它的调用方 `.catch(() => false)` 把错误吞掉——
// 表现是「点了确认什么都不发」。所以这里直接断言 `binding().session.command()` 会落到 `CommandRunner`。
//
// 不需要浏览器：`SessionRemote` 与 `CommandRunner` 都是契约类，用假实现替掉即可（本 spec 的被测面是
// `SessionControllerDefault` 自己的目录/binding 逻辑，不是 wire）。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { CommandRunner } from "@morlay/dsh-command/endpoint";
import type { CommandExecuteValue } from "@morlay/dsh-command/endpoint";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionController } from "../../contract/session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { Connection } from "@morlay/zephyr-app/client";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

/**
 * 一条目录行，**按上游 `session/list` 的真实形状**（`{ items: [...] }`，每项带 `id` / `displayTitle` /
 * `running` / `retainedBy` / `blank` / `updatedAt`）。
 *
 * 替身必须用上游形状：用我们自己编的 `{ ids, byId }` 就等于"测的是替身与 UI 的自洽"，
 * 宿主换成真实现时才会发现 UI 只认旧形状——那就是 `session/list 的响应形状不符合契约` 的来源。
 */
const ROWS = {
  items: [
    {
      sessionId: "s1",
      id: "s1",
      title: "first",
      displayTitle: "first",
      cwd: "/tmp",
      running: false,
      retainedBy: {},
      blank: false,
      updatedAt: 0,
    },
    {
      sessionId: "s2",
      id: "s2",
      title: "second",
      displayTitle: "second",
      cwd: "/tmp",
      running: true,
      retainedBy: {},
      blank: false,
      updatedAt: 0,
    },
  ],
};

/** 目录面的替身：只实现被测代码真正调的那几个方法。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  async list(): Promise<unknown> {
    return ROWS;
  }

  /** `session/follow`：首帧给空窗口，随后推一条事件 + 一帧投影增量（宿主侧的真实形状）。 */
  follow(_request: unknown, signal: AbortSignal): AsyncIterable<unknown> {
    async function* frames(): AsyncGenerator<unknown> {
      yield {
        type: "snapshot",
        // 空窗口的游标是 `-1`（上游 `SessionEventStream` 的 `emptyCursor`）。
        cursor: -1,
        records: [],
        hasMore: false,
        projections: { asOfSeq: 0, values: { permissions: { currentValue: "workspace-write" } } },
        // 事件流 opt-in 了 assistant 基线：首帧不带它，上游判成协议错误并放弃整个窗口。
        assistantStream: { revision: 0 },
      };
      if (signal.aborted) return;
      yield { type: "event", event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } };
      // 命令改完档位之后宿主推的那一帧（客户端据此更新 `faceOf`）。
      yield {
        type: "projection",
        key: "permissions",
        value: { currentValue: "danger-full-access" },
        seq: 1,
      };
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    }
    return frames();
  }

  async create(): Promise<unknown> {
    return { sessionId: "s3" };
  }

  async readPage(): Promise<unknown> {
    // 与宿主侧 `session/page` 的真实应答同形（`records` / `hasMore`）：
    // 替身用了别的字段名，就会掩盖"控制器解析字段写错"这类缺陷。
    return { records: [], hasMore: false };
  }
}

/** 命令面的替身：记录 chip 提交的那一行，并按 `outcome` 给出注册表的结算值。 */
@Injectable()
class RecordingCommandRunner extends CommandRunner {
  readonly calls: { sessionId: string; name: string; input?: string }[] = [];

  /** 下一次执行要回的结算值（默认成功）。 */
  outcome: CommandExecuteValue["result"] = { kind: "success" };

  async run(sessionId: SessionId, name: string, input?: string): Promise<CommandExecuteValue> {
    this.calls.push({ sessionId, name, ...(input === undefined ? {} : { input }) });
    return { commandId: `command-${this.calls.length}`, result: this.outcome };
  }
}

/**
 * 连接面替身：`Projections` 读 `connection.generation` 跟连接代换代。
 * 本 spec 只有一个稳定代，换代回调永不触发。
 */
@Injectable()
class FakeConnection extends Connection {
  readonly interactions = "none" as const;

  readonly generation = {
    getSnapshot: () => ({ id: 1, host: { home: "" } }),
    subscribe: () => () => {},
  };

  readonly isLoopback = true;

  readonly state = { getSnapshot: () => "connected" as const, subscribe: () => () => {} };

  readonly openWebSocket = (): WebSocket => {
    throw new Error("本 spec 不走 wire");
  };

  readonly registerGenerationSource = () => () => {};

  readonly rpc = {};

  reconnect(): void {}

  readonly start = () => ({ stop: () => {} });
}

/**
 * 装数据面：只需要 `sessions` 服务本身（渲染栈不在被测面内）。
 * @returns app 与命令执行器的替身。
 */
async function boot(): Promise<{ app: App; runner: RecordingCommandRunner }> {
  const sessionRemote = new FakeSessionRemote();
  const app = await bootstrapApplication({
    providers: [
      { provide: SessionRemote, useFactory: () => sessionRemote },
      // `sessions` 行还 inject 了 `Remote`（转发面）；本 spec 不走 wire，给个只带 `session` 的壳。
      {
        provide: Remote,
        useFactory: () =>
          ({
            // `startFollow` 按 `remote.session.follow` 的存在性收窄：给同一个替身。
            // `control` 是投影状态流（上游 `session/control`）：推一帧 baseline + 一帧增量。
            session: {
              follow: (request: unknown, signal: AbortSignal) =>
                sessionRemote.follow(request, signal),
              control: async function* control(): AsyncGenerator<unknown> {
                yield { type: "baseline", value: { projections: {} } };
                // 上游 `SessionManager.handleControlFrame` 认的是
                // `{ sessionId, seq, changes: [{ key, val }] }`（早先是 `{ type: 'projection', key, value }`）。
                yield {
                  type: "delta",
                  sessionId: "s1",
                  seq: 1,
                  changes: [{ key: "permissions", val: { currentValue: "danger-full-access" } }],
                };
                await new Promise<void>(() => {});
              },
            },
            // `onInit` 里订阅了推送（`$on`）：本 spec 没有推送面，给一个退订函数即可。
            $on: () => () => {},
            $mount: async () => () => {},
            // `startFollow` 等挂载前的等待：本 spec 直接视为已挂载。
            whenMounted: async () => {},
            whenNamespace: async () => undefined,
            wireEvents: () => () => {},
          }) as unknown as Remote,
      },
      { provide: CommandRunner, useFactory: () => new RecordingCommandRunner() },
      // 投影读面由框架提供：它自己订阅 `remote.session.control`（本 spec 的 fake 已给）。
      { provide: Connection, useFactory: () => new FakeConnection() },
      // 投影读面随 `provideSessionsStore()` 一起装（它内含 `provideProjections()`）：这里不再重复列。
      ...provideSessionsStore(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { app, runner: app.get(CommandRunner) as RecordingCommandRunner };
}

/** `sessions` 服务的形状（只取被测成员）。 */
interface Sessions {
  list: { getSnapshot(): { ids: readonly string[]; byId: Record<string, unknown>; phase: string } };
  binding(id: string):
    | {
        session?: {
          command(
            line: string,
          ): Promise<
            | { ok: true; value: { matched: boolean } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      }
    | undefined;
}

describe("sessions 行的目录与 binding", () => {
  it(
    "`refresh()` 后目录有行，`binding(id).session.command` 能提交一行命令",
    { timeout: 20_000 },
    async () => {
      const { app, runner } = await boot();
      const service = app.get(SessionController) as unknown as Sessions;

      expect(service.list.getSnapshot().ids).toEqual(["s1", "s2"]);
      // 上游 `binding` 读已物化的 scope（`scopes.get(id)?.binding`）：先 retain 才会有。
      (service as unknown as { retain(t: never, o: unknown): void }).retain("s1" as never, {
        source: "gateway",
      });
      const binding = service.binding("s1");
      expect(binding, "有目录行就必须有 binding（否则权限 chip 早退）").toBeDefined();
      expect(typeof binding?.session?.command, "`session.command` 必须是函数").toBe("function");

      const result = await binding?.session?.command("/permission danger-full-access");
      expect(result).toEqual({ ok: true, value: { matched: true } });
      // 命令被拆成 name + input 交给执行器（上游 chip 传的是整行 `/permission <preset>`）。
      expect(runner.calls).toEqual([
        { sessionId: "s1", name: "permission", input: "danger-full-access" },
      ]);
    },
  );

  it(
    "命令结算为 error 时 `command()` 不能报成功（否则 chip 把失败当成了「切换好了」）",
    { timeout: 20_000 },
    async () => {
      const { app, runner } = await boot();
      const service = app.get(SessionController) as unknown as Sessions;
      (service as unknown as { retain(t: never, o: unknown): void }).retain("s1" as never, {
        source: "gateway",
      });
      // 注册表认得这条命令（`matched` 为真）但处理器结算成失败——例如 preset 名不在目录里。
      runner.outcome = { kind: "error", text: 'unknown preset "read-only"' };

      const result = await service.binding("s1")?.session?.command("/permission read-only");
      expect(result?.ok, "处理器报错必须让调用方看得见").toBe(false);
      expect(result?.ok === false ? result.error.message : "").toContain("unknown preset");
    },
  );

  it(
    "`session/follow` 推来的事件帧会进事件窗口（投影/内容因此能更新）",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const service = app.get(SessionController) as unknown as Sessions;
      // 目录行存在 → 建 binding 时就会开 follow（`startFollow`）。
      (service as unknown as { retain(t: never, o: unknown): void }).retain("s1" as never, {
        source: "gateway",
      });
      const binding = service.binding("s1") as {
        eventSource?: { getSnapshot(): { entries: readonly { type?: string }[] } };
      };
      expect(binding.eventSource, "binding 必须带事件源").toBeDefined();
      // 让 fake 的 follow 推一帧 `{ type:'event', event }`（与宿主侧发的形状一致）。
      await new Promise((resolve) => setTimeout(resolve, 20));
      const entries = binding.eventSource?.getSnapshot().entries ?? [];
      // 窗口里的 `entries` 就是 `SessionEventLikeEntry`（`{ type: 'event', event }`）：
      // 判据是"宿主推的那条事件到了窗口"——投影与对话内容都从这里派生。
      expect(
        entries.map((entry) => entry.type),
        "事件帧必须是 `event` 包装",
      ).toContain("event");
      const pushed = entries.find((entry) => entry.type === "event") as
        | { event?: { type?: string } }
        | undefined;
      expect(pushed?.event?.type, "包装里是宿主推的那条事件").toBe("turn/start");
    },
  );

  it("投影增量帧会更新 `faceOf`（chip 文案因此跟着变）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const service = app.get(SessionController) as unknown as Sessions;
    (service as unknown as { retain(t: never, o: unknown): void }).retain("s1" as never, {
      source: "gateway",
    });
    const binding = service.binding("s1") as unknown as {
      session?: {
        projections: {
          faceOf(key: string): { getSnapshot(): unknown; subscribe(fn: () => void): () => void };
        };
      };
    };
    const face = binding.session?.projections.faceOf("permissions");
    expect(face, "binding 必须提供投影读面").toBeDefined();
    // 首帧先给 `workspace-write`，随后那帧增量把它换成 `danger-full-access`。
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(face?.getSnapshot(), "投影增量必须写进 faceOf").toMatchObject({
      currentValue: "danger-full-access",
    });
  });

  it("目录里没有的 id 不给 binding（主区因此能停在 hero）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const service = app.get(SessionController) as unknown as Sessions;
    expect(service.binding("nope")).toBeUndefined();
  });
});

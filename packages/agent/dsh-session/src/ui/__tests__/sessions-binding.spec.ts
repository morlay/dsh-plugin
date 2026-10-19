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
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionController } from "../session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

/** 一条目录行（宿主 `session/list` 的形状：`ids` + `byId`）。 */
const ROWS = {
  ids: ["s1", "s2"],
  byId: {
    s1: { id: "s1", title: "first", cwd: "/tmp", running: false, blank: false },
    s2: { id: "s2", title: "second", cwd: "/tmp", running: true, blank: false },
  },
};

/** 目录面的替身：只实现被测代码真正调的那几个方法。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  async list(): Promise<unknown> {
    return ROWS;
  }

  async create(): Promise<unknown> {
    return { sessionId: "s3" };
  }

  async readPage(): Promise<unknown> {
    return { entries: [], hasMore: false };
  }
}

/** 命令面的替身：记录 chip 提交的那一行。 */
@Injectable()
class RecordingCommandRunner extends CommandRunner {
  readonly calls: { sessionId: string; name: string; input?: string }[] = [];

  async run(sessionId: SessionId, name: string, input?: string): Promise<void> {
    this.calls.push({ sessionId, name, ...(input === undefined ? {} : { input }) });
  }
}

/**
 * 装数据面：只需要 `sessions` 服务本身（渲染栈不在被测面内）。
 * @returns app 与命令执行器的替身。
 */
async function boot(): Promise<{ app: App; runner: RecordingCommandRunner }> {
  const app = await bootstrapApplication({
    providers: [
      { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
      // `sessions` 行还 inject 了 `Remote`（转发面）；本 spec 不走 wire，给个只带 `session` 的壳。
      {
        provide: Remote,
        useFactory: () =>
          ({
            session: undefined,
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
  binding(id: string): { session?: { command(line: string): Promise<{ ok: boolean; value?: { matched: boolean } }> } } | undefined;
}

describe("sessions 行的目录与 binding", () => {
  it("`refresh()` 后目录有行，`binding(id).session.command` 能提交一行命令", { timeout: 20_000 }, async () => {
    const { app, runner } = await boot();
    const service = app.get(SessionController) as unknown as Sessions;

    expect(service.list.getSnapshot().ids).toEqual(["s1", "s2"]);
    const binding = service.binding("s1");
    expect(binding, "有目录行就必须有 binding（否则权限 chip 早退）").toBeDefined();
    expect(typeof binding?.session?.command, "`session.command` 必须是函数").toBe("function");

    const result = await binding?.session?.command("/permission danger-full-access");
    expect(result).toEqual({ ok: true, value: { matched: true } });
    // 命令被拆成 name + input 交给执行器（上游 chip 传的是整行 `/permission <preset>`）。
    expect(runner.calls).toEqual([{ sessionId: "s1", name: "permission", input: "danger-full-access" }]);
  });

  it("目录里没有的 id 不给 binding（主区因此能停在 hero）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const service = app.get(SessionController) as unknown as Sessions;
    expect(service.binding("nope")).toBeUndefined();
  });
});

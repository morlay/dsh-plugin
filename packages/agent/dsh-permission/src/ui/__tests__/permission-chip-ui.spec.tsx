// @vitest-environment happy-dom
// **权限 chip 的 UI 闭环（真实现）**：渲染上游 `PermissionSelect`，数据面用我们真正的
// `SessionControllerDefault` —— `useProjection` 就是 `binding().session.projections.faceOf('permissions')`，
// `select` 就是 `binding().session.command('/permission <preset>')`。
//
// 只有一处替身：wire（`SessionRemote` 与 `CommandRunner`）。它们承载"宿主"的状态，形状与真宿主一致：
//   - `session/list` 的行带 `projections.values.permissions = { currentValue }`；
//   - `/permission <preset>` 成功后宿主的 `permissions` 投影变成新值，下一次 `session/list` 读得到。
//
// 这样断言链是：点确认 → 真 `command()` → 真 `refresh()` → 真 `faceOf` 读到新值 → React 重渲染 → 文案变。
// 替身与真实现的差异被压到"wire 上两个方法的返回值形状"，而它们各有 node 环境的 spec 钉着
// （`permission-chip.spec` 走真宿主、`sessions-binding.spec` 钉 `command` 的语义）。
import { PermissionSelect } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionSelect.tsx";
import type { PermissionSelectProps } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionSelect.tsx";
import { accessZh } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/locales.ts";
import { CommandRunner, type CommandExecuteValue } from "@morlay/dsh-command/endpoint";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionController } from "@morlay/dsh-session/ui";
import { provideSessionsStore } from "@morlay/dsh-session/ui";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const SESSION_ID = "s-ui";

/** 宿主的 `permissions` 投影状态（本 spec 的"宿主"就是它）。 */
interface HostState {
  currentValue: string;
}

const host: HostState = { currentValue: "workspace-write" };

/** 目录行（上游 `session/list` 的 `SessionSummary` 形状，带上投影块）。 */
function rowOf(state: HostState): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    cwd: "/tmp/ui",
    blank: false,
    running: false,
    agentAvailable: true,
    updatedAt: 1,
    projections: {
      kind: "sequenced",
      asOfSeq: 1,
      values: { permissions: { currentValue: state.currentValue } },
    },
  };
}

/** 目录面替身：每次 `list` 都读宿主当前状态（等价于宿主推送后的一次读取）。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  async list(): Promise<unknown> {
    return { items: [rowOf(host)] };
  }

  async create(): Promise<unknown> {
    return { sessionId: SESSION_ID };
  }

  async readPage(): Promise<unknown> {
    return { records: [], hasMore: false };
  }
}

/** 命令面替身：`/permission <preset>` 改宿主状态（与真宿主同语义：成功才改）。 */
@Injectable()
class FakeCommandRunner extends CommandRunner {
  readonly submitted: string[] = [];

  async run(_sessionId: SessionId, name: string, input?: string): Promise<CommandExecuteValue> {
    if (name !== "permission" || input === undefined) throw new Error(`没有命令 "${name}"`);
    this.submitted.push(input);
    host.currentValue = input;
    return { commandId: `command-${this.submitted.length}`, result: { kind: "success" } };
  }
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起 client 侧的真 `sessions` 服务（wire 两个方法由替身承载）。
 * @returns app 与会话服务。
 */
async function boot(): Promise<{
  app: App;
  sessions: SessionController;
  runner: FakeCommandRunner;
}> {
  host.currentValue = "workspace-write";
  const runner = new FakeCommandRunner();
  const app = await bootstrapApplication({
    providers: [
      { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
      { provide: CommandRunner, useFactory: () => runner },
      {
        provide: Remote,
        useFactory: () =>
          ({
            session: undefined,
            $on: () => () => {},
            $mount: async () => () => {},
            whenMounted: async () => {},
            whenNamespace: async () => undefined,
          }) as unknown as Remote,
      },
      ...provideSessionsStore(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  const sessions = app.get(SessionController);
  // 物化 scope：上游 `binding(id)` 只给已 `retain` 过的会话（目录行还在装配期的首帧之前）。
  sessions.retain(SESSION_ID as never, { source: "gateway" });
  return { app, sessions, runner };
}

/** chip 的触发按钮。 */
function trigger(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /访问模式|工作区内修改|仅可查看|完全权限/,
  }) as HTMLButtonElement;
}

describe("权限 chip 的 UI（数据面是真实现）", () => {
  it("初始显示宿主当前的档位", { timeout: 20_000 }, async () => {
    const { sessions } = await boot();
    await sessions.refresh();
    renderChip(sessions);
    expect(trigger().textContent ?? "").toMatch(/工作区内修改/);
  });

  it("选「完全权限」→ 勾风险 → 确认：宿主状态与 chip 文案都变", { timeout: 20_000 }, async () => {
    const { sessions, runner } = await boot();
    await sessions.refresh();
    renderChip(sessions);

    fireEvent.click(trigger());
    expect(await screen.findByText("仅可查看")).toBeDefined();
    fireEvent.click(await screen.findByText("完全权限"));
    fireEvent.click(await screen.findByLabelText(/我已了解风险/));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "启用完全权限" }));
    });

    // 提交的是真 `binding().session.command`，落到命令执行器上。
    expect(runner.submitted, "chip 提交的必须是真的那一行命令").toEqual(["danger-full-access"]);
    expect(host.currentValue, "宿主状态必须变了").toBe("danger-full-access");
    expect(trigger().textContent ?? "", "chip 文案必须跟着宿主状态变").toMatch(/完全权限/);
  });

  it("选「仅可查看」直接生效（不需要风险确认）", { timeout: 20_000 }, async () => {
    const { sessions, runner } = await boot();
    await sessions.refresh();
    renderChip(sessions);

    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(await screen.findByText("仅可查看"));
    });
    expect(runner.submitted).toEqual(["read-only"]);
    expect(trigger().textContent ?? "").toMatch(/仅可查看/);
  });
});

/**
 * 用**真** `sessions` 服务渲染 chip：投影面走 `binding().session.projections.faceOf`，
 * 提交走 `binding().session.command`——与生产里上游 chip 拿到的完全是同一对象。
 * @param sessions - 会话服务。
 */
function renderChip(sessions: SessionController): void {
  const binding = sessions.binding(SESSION_ID) as
    | {
        session?: {
          command(line: string): Promise<{ ok: boolean }>;
          projections: {
            faceOf(key: string): {
              getSnapshot(): unknown;
              subscribe(listener: () => void): () => void;
            };
          };
        };
      }
    | undefined;
  const session = binding?.session;
  if (session === undefined) throw new Error("目录行存在时 binding 必须有 session");

  // 上游 chip 的 `useProjection`：读当前会话的某个投影（订阅它推进渲染）。
  const useProjection = (key: string, selector?: (value: unknown) => unknown): unknown => {
    const face = session.projections.faceOf(key);
    return useSyncExternalStore(
      (listener) => face.subscribe(listener),
      () => {
        const value = face.getSnapshot();
        return selector === undefined ? value : selector(value);
      },
    );
  };
  // 上游 chip 的 `select`：提交那一行命令，成功后让目录重读（宿主的投影值随之更新）。
  const select = async (preset: string): Promise<boolean> => {
    const result = await session.command(`/permission ${preset}`);
    if (!result.ok) return false;
    await act(async () => {
      await sessions.refresh();
    });
    return true;
  };
  const props = {
    locked: false,
    select,
    useProjection,
    usePermissionCatalog: (selector?: (value: unknown) => unknown) => {
      const catalog = {
        value: {
          options: [
            { value: "read-only", name: "read-only" },
            { value: "workspace-write", name: "workspace-write" },
            { value: "danger-full-access", name: "danger-full-access" },
          ],
          defaultOptions: [
            { value: "read-only", name: "read-only" },
            { value: "workspace-write", name: "workspace-write" },
            { value: "danger-full-access", name: "danger-full-access" },
          ],
          defaultPreset: "workspace-write",
        },
      };
      return selector === undefined ? catalog.value : selector(catalog);
    },
    t: ((key: string) =>
      (accessZh as Record<string, string>)[key] ?? key) as PermissionSelectProps["t"],
  };
  render(<PermissionSelect {...(props as unknown as PermissionSelectProps)} />);
}

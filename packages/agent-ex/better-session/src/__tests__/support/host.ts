// 整包宿主半的**清单**与两个入口（薄封装）：装配在 `base.ts` 的 `mountRows`，清单只在这里写一份。
//
// 三处 spec 原来各抄一份同样的清单（整包整装 / 同一根重开实例 / 端点 wire），这里一个 home：
// 会话存储 → 投影面 → wire 路由表 → 本包的行（不含 storage 接管：这些用例不装 hub）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, without } from "@morlay/zephyr";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { loopTestProviders } from "@morlay/dsh-agent-loop/testing";
import { SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionBranch } from "@morlay/better-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { StorageTakeoverDefault } from "@morlay/better-session";
import { provideBetterSession } from "@morlay/better-session/server";
import { FakeAppEnv, mountRows, type MountedRows, type RowEntry } from "./base.ts";

const rows = [
  ...provideSession(),
  ...provideSessionProjection(),
  RemoteHandlersDefault,
  // `without` 只是清单变换（剔掉 storage 接管那一行），装配照旧只有 `mountRows` 一处。
  ...provideBetterSession(without(StorageTakeoverDefault)),
] as readonly RowEntry[];

/** 一份整包装配（自己开的临时根，`dispose` 连根删掉）。 */
export interface Harness {
  /** 装配面（按令牌取服务、卸载）。 */
  readonly app: MountedRows;
  readonly root: string;
  readonly sessionStore: SessionStore;
  dispose(): Promise<void>;
}

/** 带 agent 的装配：多一个 testkit 驱动器（建真 agent 并驱动它的收件箱）。 */
export interface HarnessWithAgent {
  readonly app: Awaited<ReturnType<typeof bootstrapApplication>>;
  readonly root: string;
  readonly sessionStore: SessionStore;
  readonly agent: {
    create(id: unknown, options?: unknown, meta?: unknown): Promise<unknown>;
    claim(target: unknown, turn: number): readonly unknown[];
  };
  dispose(): Promise<void>;
}

/** 一份挂在给定数据根上的装配（根由调用方持有，`dispose` 不删它）。 */
export interface Instance {
  readonly app: MountedRows;
  readonly persistence: SessionPersistence;
  readonly branch: SessionBranch;
  readonly sessions: SessionStore;
  dispose(): Promise<void>;
}

/**
 * 起一份整包装配（数据根是新的临时目录）。
 * @returns 装配面与从里面取出的会话存储。
 */
export async function startHarness(): Promise<Harness> {
  const app = await mountRows(rows);
  return {
    app,
    root: FakeAppEnv.root,
    sessionStore: app.get(SessionStore),
    dispose: () => app.dispose(),
  };
}

/**
 * 在一个数据根上起一份装配（同一根可以起多次：每次都是新的连接与新的进程内状态）。
 * @param root - 数据根（`AppEnv.dataDir`）；由调用方的 `makeRoot` 持有，装配不删它。
 * @returns 装配面。
 */
export async function startAt(root: string): Promise<Instance> {
  const app = await mountRows(rows, { dataDir: root });
  return {
    app,
    persistence: app.get(SessionPersistence),
    branch: app.get(SessionBranch),
    sessions: app.get(SessionStore),
    dispose: () => app.dispose(),
  };
}

/**
 * 开一个数据根（用例自己持有，`removeRoot` 删）。
 * @returns 临时目录路径。
 */
export async function makeRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "better-session-root-"));
}

/**
 * 删掉一个数据根。
 * @param root - `makeRoot` 的产物。
 */
export async function removeRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/**
 * 带 **agent 行**的那份清单：整包 + `AgentLoop` / `Llm` / 命令注册表。
 *
 * 只给需要「真跑一轮」的 spec 用（`session-retry-live`）：它的 `FakeAdapter` 是在装配之后
 * `app.get(Llm).registerAdapter(["mockp"], …)` 注进去的，所以清单里只要 `Llm` 这个面在就行。
 * 现有那份 `rows` 不动——其余用例装 agent 行会多出一堆用不到的依赖。
 */
const rowsWithAgent = [
  // 会话存储、投影注册表、Llm、system-prompt、工具、agent 目录都由 testkit 装（见 `startHarnessWithAgent`），
  // 这里只留本包的行与 wire 路由表——否则同一批服务会被注册两次。
  RemoteHandlersDefault,
  ...provideBetterSession(without(StorageTakeoverDefault)),
] as readonly RowEntry[];

/**
 * 起一份**带 agent** 的整包装配（数据根是新的临时目录）。
 *
 * agent 那一串走上游 testkit（`loopTestProviders()`）：它与本包的行拼在同一份清单里，
 * 一次 `bootstrapApplication` 装完——装配入口仍然只有一处。
 * @returns 装配面、从里面取出的会话存储，以及 testkit 的 agent 驱动器。
 */
export async function startHarnessWithAgent(): Promise<HarnessWithAgent> {
  // 一次 `bootstrapApplication`：agent 那一串（Llm → 会话存储 → 投影 → system-prompt → 工具 → agent 目录）
  // 由 testkit 的清单装，本包的行也在同一份清单里——不再"手工挂行"。
  // 数据根：`FakeAppEnv.root` 是静态的，必须先设好再建行（`SessionPersistenceRdb` 要 `app-env`）。
  FakeAppEnv.root = await mkdtemp(join(tmpdir(), "better-session-agent-"));
  const app = await bootstrapApplication({
    providers: [FakeAppEnv, ...loopTestProviders(), ...rowsWithAgent],
    timeoutMs: 30_000,
  } as never);
  const agent = {
    create: async (id: unknown, options?: unknown, meta?: unknown) =>
      await app.get(AgentLoop).create(id as never, options as never, meta as never),
    claim: (target: unknown, turn: number) =>
      (target as { inbox: { claim(t: unknown, n: number): readonly unknown[] } }).inbox.claim(
        target,
        turn,
      ),
  };
  return {
    app,
    root: FakeAppEnv.root,
    sessionStore: app.get(SessionStore),
    agent,
    dispose: () => app.dispose(),
  };
}

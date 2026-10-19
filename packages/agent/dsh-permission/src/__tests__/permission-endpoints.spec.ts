/**
 * 权限 / inbox 两条远端端点的局部闭环：真 `RemoteHandlers` + 真上游服务（`UserQuestionService`、
 * `PermissionPresetService`），经 `@RemoteGroup` 注册后按 wire 上的 `namespace/method` 调用。
 *
 * 断言落在**真队列**与**真预设表**上：`attachWait` 挂到的是 `askTimed` 造出来的那条前台等待
 * （首帧 `remainingMs`），`answer` 的 `false` 来自上游对「这个 call 已不在可作答集合里」的判定，
 * 不是端点自造的值；`catalog` 的三个档位来自 `providePermission` 的预设表。
 */
import { ToolCallId } from "@morlay/dsh-agent/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { providePermission, providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox } from "@morlay/dsh-sandbox";
import { SandboxDefault } from "@morlay/dsh-sandbox";
import { SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, Injectable, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import { PERMISSION_PRESETS_CATALOG_ENDPOINT } from "../endpoint/permission-presets-endpoint.ts";
import { USER_QUESTIONS_ANSWER_ENDPOINT, USER_QUESTIONS_ATTACH_WAIT_ENDPOINT } from "../endpoint/user-questions-endpoint.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-permission-endpoints-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起真权限栈：`providePermission` 带来预设表、提问队列与两组端点；shell / sandbox 三行供
 * `PermissionPresetService` 声明的 `shell` 依赖。
 * @returns 应用、handler 表、活 agent 与会话 id。
 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  handlers: RemoteHandlers;
  agent: Awaited<ReturnType<AgentLoop["create"]>>;
  sessionId: string;
}> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      FakeAppEnv,
      ...provideAgent(),
      ...providePermissionFor("workspace-write"),
      RemoteHandlersDefault,
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  const sessionId = app.get(SessionStore).prepare().id;
  const agent = await app.get(AgentLoop).create(sessionId, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
  return { app, handlers: app.get(RemoteHandlers), agent, sessionId };
}

describe("权限 / inbox 的宿主端点", () => {
  it("`permissionPresets/catalog` 返回 providePermission 的真预设表", { timeout: 20_000 }, async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke(PERMISSION_PRESETS_CATALOG_ENDPOINT, {});
    expect(result).toMatchObject({
      ok: true,
      value: {
        options: [{ value: "read-only" }, { value: "workspace-write" }, { value: "danger-full-access" }],
        // 默认档位是装配给 `providePermission.withConfig(...)` 的那一档（不再从 shell/approval 的默认值反推）。
        defaultPreset: "workspace-write",
      },
    });
  });

  it("`userQuestions/attachWait` 没有前台等待时立即结束（无帧）", { timeout: 20_000 }, async () => {
    const { handlers, sessionId } = await boot();
    const source = handlers.stream(
      USER_QUESTIONS_ATTACH_WAIT_ENDPOINT,
      { agent: sessionId, callId: "call-none" },
      new AbortController().signal,
    );
    if (source === undefined) throw new Error("userQuestions/attachWait 没有注册成流式端点");
    expect(await source[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
  });

  it("`userQuestions/attachWait` 挂到真 `askTimed` 的前台等待上：首帧是 remainingMs", { timeout: 20_000 }, async () => {
    const { app, handlers, agent, sessionId } = await boot();
    const questions = app.get(UserQuestionQueue);
    const callId = ToolCallId("call-1");
    const lifetime = new AbortController();
    const asking = questions
      .askTimed(
        { questions: [{ id: "q1", question: "在吗？" }], agent, signal: lifetime.signal },
        callId,
        5_000,
      )
      .catch(() => undefined);

    // 让 `askTimed` 先把 wait 放进队列（它随后挂在没有应答者的 waterfall 上）。
    await new Promise((resolve) => setTimeout(resolve, 20));

    const source = handlers.stream(
      USER_QUESTIONS_ATTACH_WAIT_ENDPOINT,
      { agent: sessionId, callId },
      new AbortController().signal,
    );
    if (source === undefined) throw new Error("userQuestions/attachWait 没有注册成流式端点");
    const first = await source[Symbol.asyncIterator]().next();
    // `TimedQuestionWait.attach` 的首帧就是 `{ remainingMs }`（随后挂到等待结束）。
    expect(first).toEqual({ done: false, value: { remainingMs: expect.any(Number) } });

    lifetime.abort(new Error("spec: 收尾"));
    await asking;
  });

  it("`userQuestions/answer` 的 false 来自上游队列判定（未知 call 不可作答）", { timeout: 20_000 }, async () => {
    const { handlers, sessionId } = await boot();
    const result = await handlers.invoke(USER_QUESTIONS_ANSWER_ENDPOINT, {
      agent: sessionId,
      callId: "call-unknown",
      answer: { answers: [{ id: "q1", selected: ["ok"] }] },
    });
    expect(result).toEqual({ ok: true, value: false });
  });
});

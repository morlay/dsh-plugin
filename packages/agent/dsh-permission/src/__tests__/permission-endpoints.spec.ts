/**
 * 权限 / inbox 两条远端端点的局部闭环：真 `RemoteHandlers` + 真上游服务（`UserQuestionService`、
 * `PermissionPresetService`），经 `@RemoteGroup` 注册后由契约的客户端形态调用（`client.catalog()` /
 * `client.answer(...)`）——spec 里不拼 wire 名，名字的 home 只有契约类。`attachWait` 是流式，
 * 客户端形态的转发只覆盖 unary，所以它在 handler 表上开流；端点名同样**从契约编译出来**
 * （`remoteDescriptorsOf`），不是手抄的字符串。
 *
 * 断言落在**真队列**与**真预设表**上：`attachWait` 挂到的是 `askTimed` 造出来的那条前台等待
 * （首帧 `remainingMs`），`answer` 的 `false` 来自上游对「这个 call 已不在可作答集合里」的判定，
 * 不是端点自造的值；`catalog` 的三个档位来自 `providePermission` 的预设表。
 */
import { ToolCallId } from "@morlay/dsh-agent/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAgent } from "@morlay/dsh-agent";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox } from "@morlay/dsh-sandbox";
import { SandboxDefault } from "@morlay/dsh-sandbox";
import { SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { LocalRemote } from "@morlay/zephyr-app/testing";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import { UserQuestionsEndpoint } from "../endpoint/user-questions-endpoint.ts";
import { PermissionPresetsEndpointClient } from "../ui/permission-presets-endpoint.client.ts";
import { UserQuestionsEndpointClient } from "../ui/user-questions-endpoint.client.ts";

/**
 * `userQuestions/attachWait` 的 wire 端点名：**从契约编译出来**（`remoteDescriptorsOf` 读
 * `@RemoteGroup` / `@RemoteMethod({ mode: "stream" })`），spec 不手抄字符串。
 * @returns 那一条流式端点的 `<组名>/<方法名>`。
 */
function attachWaitEndpoint(): string {
  const stream = remoteDescriptorsOf(UserQuestionsEndpoint).descriptors.find(
    (descriptor) => descriptor.mode === "stream",
  );
  if (stream === undefined) {
    throw new Error("契约上没有声明流式的 attachWait：userQuestions 组少了一条流");
  }
  return `${stream.namespace}/${stream.method}`;
}

/** 指向临时目录的运行环境。 */
/**
 * 起真权限栈：`providePermission` 带来预设表、提问队列与两组端点；shell / sandbox 三行供
 * `PermissionPresetService` 声明的 `shell` 依赖。
 * @returns 应用、handler 表、活 agent 与会话 id。
 */
async function boot(appEnv: AppEnvFixture): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  handlers: RemoteHandlers;
  agent: Awaited<ReturnType<AgentLoop["create"]>>;
  sessionId: string;
}> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),

      { provide: AppEnv, useValue: appEnv },
      ...provideAgent(),
      // 顺序即装配顺序：`shell` / `bash` 的适配面要先就位，权限行构造期就读 `ctx.shell.sandboxMode`。
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
      ...providePermissionFor("workspace-write"),
      // 循环期：本 spec 要真 `AgentLoop` 建会话（骨架只给契约，不给循环本体）。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      RemoteHandlersDefault,
      // 客户端半：spec 用契约的客户端形态调端点（`client.catalog()` / `client.answer(...)`），
      // 转发落回本进程的 handler 表——与线上同形，只是换了传输。
      LocalRemote,
    ],
    timeoutMs: 20_000,
  });
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  const sessionId = app.get(SessionStore).prepare().id;
  const agent = await app
    .get(AgentLoop)
    .create(
      sessionId,
      { provider: "deepseek-official", model: "deepseek-flash" },
      { cwd: appEnv.values.dataDir },
    );
  return { app, handlers: app.get(RemoteHandlers), agent, sessionId };
}

describe("权限 / inbox 的宿主端点", () => {
  test(
    "`permissionPresets/catalog` 返回 providePermission 的真预设表",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { app } = await boot(appEnv);
      const catalog = await app.get(PermissionPresetsEndpointClient).catalog();
      // 裸值口径（RemoteResult 归桥/客户端面）；包过一层这里会是 { ok, value }。
      expect(catalog).not.toHaveProperty("ok");
      expect(catalog).toMatchObject({
        options: [
          { value: "read-only" },
          { value: "workspace-write" },
          { value: "danger-full-access" },
        ],
        // 默认档位是装配给 `providePermission.withConfig(...)` 的那一档。
        defaultPreset: "workspace-write",
      });
    },
  );

  test(
    "`userQuestions/attachWait` 没有前台等待时立即结束（无帧）",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { handlers, sessionId } = await boot(appEnv);
      const source = handlers.stream(
        attachWaitEndpoint(),
        { agentId: SessionId(sessionId), callId: ToolCallId("call-none") },
        new AbortController().signal,
      );
      if (source === undefined) throw new Error("userQuestions/attachWait 没有注册成流式端点");
      expect(await source[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
    },
  );

  test(
    "`userQuestions/attachWait` 挂到真 `askTimed` 的前台等待上：首帧是 remainingMs",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { app, handlers, agent, sessionId } = await boot(appEnv);
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
        attachWaitEndpoint(),
        { agentId: SessionId(sessionId), callId },
        new AbortController().signal,
      );
      if (source === undefined) throw new Error("userQuestions/attachWait 没有注册成流式端点");
      const first = await source[Symbol.asyncIterator]().next();
      // `TimedQuestionWait.attach` 的首帧就是 `{ remainingMs }`（随后挂到等待结束）。
      expect(first).toEqual({ done: false, value: { remainingMs: expect.any(Number) } });

      lifetime.abort(new Error("spec: 收尾"));
      await asking;
    },
  );

  test(
    "`userQuestions/answer` 的 false 来自上游队列判定（未知 call 不可作答）",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { app, sessionId } = await boot(appEnv);
      const result = await app.get(UserQuestionsEndpointClient).answer(
        SessionId(sessionId),
        ToolCallId("call-unknown"),
        { answers: [{ id: "q1", selected: ["ok"] }] },
      );
      // 裸值口径：`false` 是上游队列的判定（未知 call 不可作答），不再是 `{ ok, value }`。
      expect(result).toBe(false);
    },
  );
});

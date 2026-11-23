// 提问的**全链路**判据（本层是「域行为」的门禁：落在会话域的 ui 面）：真宿主（Web + Connection + ApiGateway + 转发源）+ 真客户端 transport + 真 HTTP/WS。
//
// 之前只有局部用例（进程内应答者 / 夹具 gateway），于是「监听器在、帧也入了队，却按没人应答结束」
// 这类断点一条都测不到。这一条把两端接起来：客户端订阅 `$events`、宿主侧执行 `ask_user_question`、
// 客户端收到 waterfall 帧并作答、答复经 `$events/result` 回到宿主、工具拿到答案。
import { executeToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { provideFsTools, provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideShell } from "@morlay/dsh-shell/server";
import {
  AppEnv,
  TypertGateway,
  WebServer,
  provideApiGateway,
  provideConnection,
  provideMuxServer,
  provideTypert,
  provideWeb,
  type AppEnvValues,
} from "@morlay/zephyr-app";
import { muxTransport } from "@morlay/zephyr-app/client";
import { CredentialsInMemory } from "@morlay/zephyr-app/testing";
import { bootstrapApplication, configure, Injectable, type App } from "@morlay/zephyr";
import { ToolCallId } from "@morlay/dsh-agent/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideAskUserTool, providePermissionFor } from "@morlay/dsh-permission/server";

let root = "";

const opened: App[] = [];

const signal = new AbortController().signal;

/** 运行环境替身：数据根指到临时目录。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  if (root !== "") await rm(root, { recursive: true, force: true });
}, 30_000);

/** 起一份**带 wire 面**的宿主（与 dev 同形的那些行）。 */
async function boot(): Promise<App> {
  root = await mkdtemp(join(tmpdir(), "dsh-question-roundtrip-"));
  process.env.PORT = "0";
  const app = await bootstrapApplication({
    providers: [
      ...provideWeb(),
      CredentialsInMemory,
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideMuxServer(),
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      FakeAppEnv,
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root }),
      ),
      ...provideWorkingDirectory(),
      ...provideAgentLoop(),
      ...provideFsTools(),
      ...providePermissionFor("workspace-write"),
      ...provideAskUserTool(),
    ],
    timeoutMs: 30_000,
  } as never);
  opened.push(app);
  return app;
}

describe("提问的全链路（真宿主 + 真客户端 transport）", () => {
  it("客户端收到 waterfall 帧并作答：工具拿到结构化答案", { timeout: 30_000 }, async () => {
    const app = await boot();
    const origin = `http://127.0.0.1:${String(app.get(WebServer).port)}`;

    // 客户端：真 WebSocket（流式 + 事件流）+ 真 HTTP（unary 与 `$events/result`）。
    const transport = muxTransport(
      () =>
        ({
          openWebSocket: (path: string) =>
            new WebSocket(`${origin.replace(/^http/u, "ws")}${path}`),
        }) as never,
      (input, init) => fetch(`${origin}${new URL(String(input), origin).pathname}`, init),
    );

    const asked: string[] = [];
    transport.answer?.(async (invocation) => {
      asked.push(invocation.event);
      return {
        kind: "result",
        value: { answers: [{ id: "q1", selected: ["好"] }] },
      };
    });

    // 等客户端的事件流真的就位再发请求：没有这条流，宿主会按「没人应答」把请求结掉，
    // 而下面的断言只看结果，看不出是「没通道」还是「答错了」。
    const gateway = app.get(TypertGateway);
    await vi.waitFor(() => expect(gateway.hasLiveClient(), "客户端的事件流必须先就位").toBe(true), {
      timeout: 10_000,
    });

    const { agent } = await app.get(AgentDirectory).create({
      sessionId: SessionId("question-roundtrip"),
      meta: { cwd: root },
    });

    const result = await executeToolFixture(agent.ctx, {
      signal,
      callId: ToolCallId("call-question-roundtrip"),
      name: "ask_user_question",
      agent,
      arguments: { questions: [{ id: "q1", question: "全链路通了吗？" }] },
    });

    // 同一条请求只该投给浏览器一次：投两次会让界面弹两张卡、宿主收两个答复。
    expect(asked).toEqual(["user-questions/request"]);
    expect(result.isError).toBe(false);
    const text = JSON.stringify(result.content);
    expect(text).toContain("好");
  });
});

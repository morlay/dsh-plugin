// per-agent 装配的触发点：`@AgentScoped()` 的行由 `AgentLoopDefault` 在**每个 agent 创建时**装进它的
// `agentCtx`——不早不晚：调用方的 `setup` 跑完之后、`agent/created` 之前。
//
// 判据只有一条：**建一个 agent 就多一份**（不是装配期一份、也不是每个会话共享一份）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentDirectory,
  AgentScoped,
  provideAgent,
  provideWorkingDirectory,
} from "@morlay/dsh-agent";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { AppEnv, RemoteHandlersDefault, type AppEnvValues } from "@morlay/zephyr-app";
import { bootstrapApplication, configure, Injectable, type App } from "@morlay/zephyr";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provideAgentLoop } from "../index.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-per-agent-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 运行环境替身（与 `agent-loop.spec.ts` 同形）。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

/** 每次 `onInit` 记一笔：判据是「每个 agent 一份」。 */
const installed: string[] = [];

/** 一个声明了 agent scope 的行：它会由 per-agent 装配器装进每个 agent。 */
@AgentScoped()
class AgentProbe {
  onInit(): void {
    installed.push("probe");
  }
}

/**
 * 起一个能真建 agent 的装配（会话 + 骨架 + 循环期），外加那条探针行。
 * @returns 装配结果。
 */
async function boot(): Promise<App> {
  return await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      FakeAppEnv,
      RemoteHandlersDefault,
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: tmpdir() }),
      ),
      ...provideWorkingDirectory(),
      ...provideAgentLoop(),
      // 探针：声明了 `@AgentScoped()`，装进每个 agent 的 scope，不进应用根。
      AgentProbe,
    ],
  } as never);
}

describe("per-agent 装配的触发点", () => {
  it(
    "每建一个 agent 装一次：装配期 0 份，第一个 agent 1 份，第二个 agent 2 份",
    { timeout: 60_000 },
    async () => {
      const app = await boot();
      try {
        expect(installed, "装配期不装（它不在应用根）").toEqual([]);

        await app.get(AgentDirectory).create({
          sessionId: SessionId("per-agent-1"),
          meta: { cwd: root },
        });
        expect(installed, "第一个 agent 一份").toEqual(["probe"]);

        await app.get(AgentDirectory).create({
          sessionId: SessionId("per-agent-2"),
          meta: { cwd: root },
        });
        expect(installed, "第二个 agent 再加一份").toEqual(["probe", "probe"]);
      } finally {
        await app.dispose();
      }
    },
  );
});

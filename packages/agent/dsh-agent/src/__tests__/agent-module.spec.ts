/**
 * 装配冒烟：`provideAgent` 的一组 provider 能起来，端口也能取到。
 *
 * 只做「装配成功 + 令牌可用」这一层；跑循环的用例在 `agent-loop.spec.ts`。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentLoop, AgentDirectory, Llm, SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";

/**
 * 测试用的运行环境：每个用例一个**临时目录**（退出时删掉）。
 *
 * 写死路径会让多个用例共用同一份 sessions/ 目录，前一个用例的残留会污染后一个。
 */
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-agent-spec-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

@Injectable()
class FakeAppEnv extends AppEnv {
  private readonly root = root;

  readonly values: AppEnvValues = {
    dataDir: this.root,
    profileDir: this.root,
    dev: false,
  };

  readonly cacheDir = join(this.root, "cache");

  readonly packageRoot = join(this.root, "pkg");

  readonly appBootDir = join(this.root, "boot");

  /** 装配根的清单路径（测试只用到路径，不读内容）。 */
  readonly profileManifest = join(this.root, "package.json");
}

describe("provideAgent", () => {
  it(
    "装配后 AgentDirectory / Llm / ToolRegistry / SystemPrompt / AgentLoop 都能解析",
    { timeout: 20_000 },
    async () => {
      const app = await bootstrapApplication({ providers: [...provideSession(), ...provideSessionProjection(), FakeAppEnv, RemoteHandlersDefault, ...provideAgent()] });
      try {
        expect(app.get(AgentDirectory)).toBeDefined();
        expect(app.get(Llm)).toBeDefined();
        expect(app.get(ToolRegistry)).toBeDefined();
        expect(app.get(SystemPrompt)).toBeDefined();
        expect(app.get(AgentLoop)).toBeDefined();
      } finally {
        await app.dispose();
      }
    },
  );
});

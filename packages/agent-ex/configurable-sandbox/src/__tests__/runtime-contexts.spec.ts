// 运行时策略文本的接管时机：`SandboxRuntimeContexts` 在 agent 创建时就注册同名 context，
// **第一次装配**（assemble）拿到的就是本包文本；没装审批服务时 `approval:policy` 是空串。
//
// 这条守的是时机而不是文本内容（文本在 `policy-text.spec.ts`）：挂在装配瀑布里注册只能从第二次
// 装配起生效，症状是"先英文后中文"。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVAL_POLICY_CONTEXT,
  SANDBOX_POLICY_CONTEXT,
  SandboxRulesDefault,
  SandboxRuntimeContexts,
} from "@morlay/configurable-sandbox";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { FakePolicy } from "./support/fake-policy.ts";
import { fakeSandboxFileOf } from "./support/fake-sandbox-file.ts";

interface RegisteredContext {
  readonly name: string;
  readonly order: number;
  readonly text: (context: unknown) => string;
}

// 提示词注册面的替身：只实现本包用到的两个入口。
class FakePrompt {
  readonly contexts = new Map<string, RegisteredContext>();

  context(entry: RegisteredContext): () => void {
    this.contexts.set(entry.name, entry);
    return () => this.contexts.delete(entry.name);
  }

  getContextOrder(name: string): number {
    return name === "SANDBOX_POLICY" ? 100 : 200;
  }
}

// agent 替身：`install` 只读 `ctx.get("systemPrompt")` 与 `session.id`。
function agentOf(prompt: FakePrompt) {
  return {
    session: { id: "s1" },
    ctx: {
      get(name: string, _strict?: boolean): unknown {
        return name === "systemPrompt" ? prompt : undefined;
      },
    },
  };
}

async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "configurable-sandbox-rt-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  FakePolicy.root = join(root, "ws");
  // 规则层的缺省 cwd 来自 AppEnv（不读进程 cwd）：起始目录指到本用例的 workspace。
  const rules = `access = ["rw /tmp/extra"]`;
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: createTestingAppEnv({ root: FakePolicy.root }) },
      fakeSandboxFileOf(rules),
      SandboxRulesDefault,
      FakePolicy,
      SandboxRuntimeContexts,
    ],
    timeoutMs: 10_000,
  });
  onTestFinished(() => app.dispose().catch(() => undefined));
  return app;
}

describe("运行时策略文本的接管时机", () => {
  test("agent 创建时注册同名 context：第一次装配就是本包文本", async () => {
    const app = await boot();
    const prompt = new FakePrompt();
    const agent = agentOf(prompt);

    // cordis 的事件面按字符串派发；`agent/created` 的模块增强不在本仓 program 里，这里只借运行期契约。
    (app.ctx as { emit(name: string, ...args: unknown[]): void }).emit("agent/created", { agent });

    expect([...prompt.contexts.keys()]).toEqual([SANDBOX_POLICY_CONTEXT, APPROVAL_POLICY_CONTEXT]);

    const text = prompt.contexts.get(SANDBOX_POLICY_CONTEXT)!.text({ agent });
    expect(text).toContain("文件策略：workspace-write");
    expect(text).toContain("额外可写：/tmp/extra");
    // 同一装配再取一次结果一致（不是"第二次才生效"的两段式）。
    expect(prompt.contexts.get(SANDBOX_POLICY_CONTEXT)!.text({ agent })).toBe(text);
  });

  test("没有审批服务时 approval:policy 是空串（空串遮蔽不了任何东西）", async () => {
    const app = await boot();
    const prompt = new FakePrompt();
    const agent = agentOf(prompt);

    // cordis 的事件面按字符串派发；`agent/created` 的模块增强不在本仓 program 里，这里只借运行期契约。
    (app.ctx as { emit(name: string, ...args: unknown[]): void }).emit("agent/created", { agent });

    expect(prompt.contexts.get(APPROVAL_POLICY_CONTEXT)!.text({ agent })).toBe("");
  });
});

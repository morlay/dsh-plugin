/**
 * permission 域的真装配：真 `UserQuestionService` + 真投影注册表，只要求临时目录之外无外部依赖。
 *
 * 行为断言落在 `ask` 的**本地校验**上（不需要 UI 应答者，也不联网）：
 * 空问题清单被拒、声明的 approve 不属于本题选项被拒、已取消的请求立刻以取消结束。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import { UserQuestionQueueDefault } from "../user-question-queue.service.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-permission-"));
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
});

/** 起真 permission 栈（队列行要 `agents`，所以装真 agent 域，不造假件）。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    FakeAppEnv, ...provideAgent(), UserQuestionQueueDefault],
    timeoutMs: 20_000,
  });
  apps.push(app);
  return { app };
}

describe("permission 域的用户提问", () => {
  it("装配后 UserQuestionQueue 可解析", { timeout: 20_000 }, async () => {
    const { app } = await boot();

    const questions = app.get(UserQuestionQueue);
    expect(typeof questions.ask).toBe("function");
  });

  it("ask 的三条本地拒绝路径：空清单 / 意图标签不属于选项 / 已取消", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const questions = app.get(UserQuestionQueue);

    await expect(questions.ask({ questions: [] })).rejects.toMatchObject({
      name: "UserQuestionError",
      code: "EMPTY_QUESTIONS",
    });

    await expect(
      questions.ask({
        questions: [
          {
            id: "q1",
            question: "要发布吗？",
            options: [{ label: "先别发" }],
            intent: { kind: "plan-review", approve: "发布" },
            detail: "计划正文",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_INTENT" });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      questions.ask({
        questions: [{ id: "q2", question: "在吗？" }],
        signal: aborted.signal,
      }),
    ).rejects.toThrow();
  });
});

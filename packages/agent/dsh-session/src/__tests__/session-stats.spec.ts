// `sessionStats` 投影（上游 `session-stats`）：整条日志的轮数 / 步数与 LLM、工具、首字、解码的墙钟时长。
//
// 为什么值得钉：客户端的 `ui-chat` 用它渲染输入区下方那两枚统计 pills（`activity` / `usage`），
// 而两枚 pill 都是**有数据才渲染**（`steps === 0` / token 全零就返回 null）。投影没注册时它们退回
// 「窗口内节点」的估算——翻页与压缩之后只统计到一段，界面上就表现为"时长 / ttft / tps 都没有"。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAppEnv } from "./support/fake-app-env.ts";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

describe("`sessionStats` 投影", { timeout: 20_000 }, () => {
  it("装配后会话里就有这个键，初值是全零的计数与时长", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-session-stats-"));
    roots.push(root);
    FakeAppEnv.root = root;
    const app = await bootstrapApplication({
      providers: [...provideSession(), ...provideSessionProjection(), FakeAppEnv],
      timeoutMs: 20_000,
    });
    opened.push(app);

    // `prepare()` 返回的就是 Session 实例（`get(id)` 那条路要等 store 落定，这里用不着）。
    const session = app.get(SessionStore).prepare();

    const values = (
      app.get(SessionProjectionStore).snapshot(session) as {
        values?: Record<string, unknown>;
      }
    ).values;
    expect(Object.keys(values ?? {})).toContain("sessionStats");
    // 形状给到渲染面读的那几项：两枚 pill 分别看 `steps` 与 token 计数。
    expect(values?.["sessionStats"]).toMatchObject({
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      decodeMs: 0,
      decodeTokens: 0,
    });
  });
});

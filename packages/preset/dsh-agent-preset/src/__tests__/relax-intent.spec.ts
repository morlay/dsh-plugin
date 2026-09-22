// 行为：本 preset 的会话放宽写/改 intent，其余会话照旧吃上游策略，且必须抢在它前面。
import { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-fs";
import { createScope } from "@deepseek-ai/dsh-scope";
import { afterEach, describe, expect, it } from "vitest";
import * as relaxPlugin from "../relax-intent.ts";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 上游 `fs-observation-policy` 的形状：占住决策槽（不调用 `next()`），给出它算出的 intent。 */
function mountObservationPolicy(ctx: Context, behaviour: () => unknown): void {
  ctx.on("fs/edit-intent", behaviour as never);
  ctx.on("fs/write-intent", behaviour as never);
}

const target = { targetKey: "src/a.ts", displayPath: "src/a.ts" } as never;

async function dispatch(ctx: Context, actor: object | undefined): Promise<unknown> {
  return await ctx.waterfall("fs/edit-intent", target, actor, () => undefined);
}

describe("fs-intent-relax", () => {
  it("本 preset 的会话拿到 undefined（无条件编辑），别的会话拿到上游的 intent", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    mountObservationPolicy(ctx, () => ({ version: "v-observed" }));

    const ownKey = { preset: "coding" };
    const otherKey = { preset: "standard" };
    const own = createScope(ctx, ownKey);
    const ours = createScope(ctx, { agent: "ours" }, { parent: ownKey });
    const theirs = createScope(ctx, { agent: "theirs" }, { parent: otherKey });
    await own.ctx.plugin(relaxPlugin);

    expect(await dispatch(ctx, { agent: { ctx: ours.ctx } })).toBeUndefined();
    expect(await dispatch(ctx, { agent: { ctx: theirs.ctx } })).toEqual({ version: "v-observed" });
  });

  it("上游以抛错拒绝（未读就改）时，本 preset 的会话照样放宽，别的会话照旧收错", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    mountObservationPolicy(ctx, () => {
      throw new Error("FS_NOT_OBSERVED");
    });

    const ownKey = { preset: "coding" };
    const own = createScope(ctx, ownKey);
    const ours = createScope(ctx, { agent: "ours" }, { parent: ownKey });
    const stranger = createScope(ctx, { agent: "stranger" });
    await own.ctx.plugin(relaxPlugin);

    await expect(dispatch(ctx, { agent: { ctx: ours.ctx } })).resolves.toBeUndefined();
    await expect(dispatch(ctx, { agent: { ctx: stranger.ctx } })).rejects.toThrow("FS_NOT_OBSERVED");
  });

  it("没有 agent 的 actor（直接工具调用）不吃放宽：归属判不出来就照上游办", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    mountObservationPolicy(ctx, () => ({ version: "v-observed" }));

    const own = createScope(ctx, { preset: "coding" });
    await own.ctx.plugin(relaxPlugin);

    expect(await dispatch(ctx, undefined)).toEqual({ version: "v-observed" });
  });

  it("抢在上游前面是硬要求：排在它后面时监听根本不会执行", async () => {
    // 上游 policy 不调用 `next()`，所以链上排在它后面的监听者永不执行。这条用例把「prepend 丢了」
    // 变成可见的失败：去掉 prepend 后，本 preset 的会话会拿到 { version: "v-observed" }。
    const ctx = new Context();
    contexts.push(ctx);
    mountObservationPolicy(ctx, () => ({ version: "v-observed" }));

    const ownKey = { preset: "coding" };
    const own = createScope(ctx, ownKey);
    const ours = createScope(ctx, { agent: "ours" }, { parent: ownKey });
    await own.ctx.plugin(relaxPlugin);

    const seen: string[] = [];
    ctx.on("fs/edit-intent", async (_target, _actor, _next) => {
      seen.push("tail");
      return undefined;
    });

    expect(await dispatch(ctx, { agent: { ctx: ours.ctx } })).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

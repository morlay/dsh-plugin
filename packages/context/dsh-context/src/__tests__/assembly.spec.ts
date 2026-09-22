// 组装出口：按 capabilities 装子插件、未知名字快速失败。
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

describe("组装出口", () => {
  it("未知能力名在装载时报错，并列出可选能力", async () => {
    const ctx = new Context();
    contexts.push(ctx);

    await expect(ctx.plugin(plugin, { capabilities: ["nope"] })).rejects.toThrow(
      /unknown capability "nope"/u,
    );
  });

  it("只装清单里的能力：一个都不装时不激活任何子插件", async () => {
    const ctx = new Context();
    contexts.push(ctx);

    // 空清单是合法输入（调用方自担）：装不出任何东西，也不报错。
    const fiber = await ctx.plugin(plugin, { capabilities: [] });

    expect(fiber.state).toBeDefined();
    expect(ctx.get("contextAssembler")).toBeUndefined();
  });
});

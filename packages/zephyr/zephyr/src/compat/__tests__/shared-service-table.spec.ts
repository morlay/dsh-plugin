import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { bootstrapApplication, Injectable, inject } from "@morlay/zephyr";
import { toCordis } from "@morlay/zephyr/compat";

describe("服务表挂在根 ctx 上共享", () => {
  it("两个独立的 bootstrapApplication 在子 ctx 上互相解析令牌", async () => {
    @Injectable()
    class Left {
      value = "left";
    }

    @Injectable()
    class Right {
      left = inject(Left);
    }

    const root = new Context();
    const leftCtx = root.extend();
    const rightCtx = root.extend();

    const leftApp = await bootstrapApplication({
      ctx: leftCtx,
      providers: [Left],
    });
    const rightApp = await bootstrapApplication({
      ctx: rightCtx,
      providers: [Right],
    });

    expect(rightApp.get(Right).left.value).toBe("left");

    await rightApp.dispose();
    await leftApp.dispose();
  });
});

describe("toCordis：Provider 转成 dsh 行", () => {
  it("行 name 取 token 名，config 传给 Provider 构造参数", async () => {
    @Injectable()
    class RowProvider {
      constructor(readonly config: { value: number }) {}
    }

    const row = toCordis(RowProvider);
    expect(row.name).toBe("row-provider");

    const ctx = new Context();
    const dispose = await row.apply(ctx, { value: 7 });

    @Injectable()
    class Consumer {
      provider = inject(RowProvider);
    }

    const app = await bootstrapApplication({ ctx, providers: [Consumer] });
    expect(app.get(Consumer).provider.config.value).toBe(7);

    await app.dispose();
    await dispose();
  });

  it("裸 cordis 插件条目由 bootstrapApplication 直接装载", async () => {
    let applied = false;
    const raw = {
      name: "native-row",
      apply: () => {
        applied = true;
      },
    };

    const app = await bootstrapApplication({ providers: [raw] });
    expect(applied).toBe(true);
    await app.dispose();
  });
});


/**
 * 生命周期基线（A 组）：onInit 失败、卸载幂等/顺序、@Module 串行、卸载后名字清理、可选注入三态。
 *
 * 这些用例定义「组合业务时可预期的行为」——改动框架时必须一直绿。
 */
import { describe, expect, it } from "vitest";
import { Module, bootstrapApplication, Injectable, inject, serviceNamesOf, type Context, type Lifecycle } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

describe("A1 onInit 失败", () => {
  it("应用不启动，且已启动的 provider 逆序卸载", async () => {
    const events: string[] = [];

    @Injectable()
    class Started implements Lifecycle {
      onInit() {
        events.push("started:init");
      }

      onDispose() {
        events.push("started:dispose");
      }
    }

    @Injectable()
    class Broken implements Lifecycle {
      onInit() {
        events.push("broken:init");
        throw new Error("boom");
      }
    }

    await expect(bootstrapApplication({ providers: [Started, Broken] })).rejects.toThrow("boom");
    expect(events).toContain("started:init");
    expect(events).toContain("started:dispose");
  });
});

describe("A2 卸载幂等", () => {
  it("dispose 两次只执行一次清理", async () => {
    let disposed = 0;

    @Injectable()
    class Once implements Lifecycle {
      onDispose() {
        disposed += 1;
      }
    }

    const app = await bootstrapApplication({ providers: [Once] });
    await app.dispose();
    await app.dispose();
    expect(disposed).toBe(1);
  });
});

describe("A3 卸载顺序", () => {
  it("与装配顺序相反，且 onDispose 里依赖仍可读", async () => {
    const events: string[] = [];

    @Injectable()
    abstract class Store {
      abstract kind(): string;
    }

    @Injectable()
    class PgStore extends Store {
      kind() {
        return "pg";
      }

      onDispose() {
        events.push("pg:dispose");
      }
    }

    @Injectable()
    class Consumer implements Lifecycle {
      store = inject(Store);

      onDispose() {
        events.push(`consumer:dispose:${this.store.kind()}`);
      }
    }

    const app = await bootstrapApplication({ providers: [PgStore, Consumer] });
    await app.dispose();
    expect(events).toEqual(["consumer:dispose:pg", "pg:dispose"]);
  });
});

describe("A4 @Module imports 串行", () => {
  it("imports 在 providers 之前、按声明顺序装配", async () => {
    const order: string[] = [];

    @Injectable()
    class First implements Lifecycle {
      onInit() {
        order.push("first");
      }
    }

    @Injectable()
    class Second implements Lifecycle {
      onInit() {
        order.push("second");
      }
    }

    @Injectable()
    class Own implements Lifecycle {
      onInit() {
        order.push("own");
      }
    }

    @Module({ providers: [First] })
    class FirstModule {}

    @Module({ providers: [Second] })
    class SecondModule {}

    @Module({ imports: [FirstModule, SecondModule], providers: [Own] })
    class RootModule {}

    const app = await bootstrapApplication({ imports: [RootModule] });
    expect(order).toEqual(["first", "second", "own"]);
    await app.dispose();
  });
});

describe("A5 卸载后根名字清理", () => {
  it("dispose 后契约名从根名字视图移除、令牌不再可解析", async () => {
    const upstream = {
      name: "cleanable",
      apply: (ctx: any) => ctx.provide("cleanable", { ok: true }),
    };

    @Injectable()
    abstract class Cleanable {
      abstract ok: boolean;
    }

    @Injectable()
    class CleanableProvider extends fromCordis(Cleanable, upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [CleanableProvider] });
    expect(app.get(Cleanable).ok).toBe(true);
    expect(serviceNamesOf(app.ctx).has("cleanable")).toBe(true);
    await app.dispose();
    expect(serviceNamesOf(app.ctx).has("cleanable")).toBe(false);
    expect(app.tryGet(Cleanable)).toBeUndefined();
  });
});

describe("A6 inject.optional 三态", () => {
  it("装配里没有该令牌 → undefined（不等）", async () => {
    @Injectable()
    abstract class Missing {
      abstract value: string;
    }

    @Injectable()
    class Consumer {
      missing = inject.optional(Missing);
    }

    const app = await bootstrapApplication({ providers: [Consumer] });
    expect((app.get(Consumer) as Consumer).missing).toBeUndefined();
    await app.dispose();
  });

  it("装了提供者但尚未就绪 → 等到就绪（与必填一致）", async () => {
    @Injectable()
    abstract class Slow {
      abstract ok: boolean;
    }

    @Injectable()
    class SlowDefault extends Slow {
      ok = true;
    }

    @Injectable()
    class Consumer {
      slow = inject.optional(Slow);

      seen: boolean | undefined;

      onInit() {
        this.seen = this.slow?.ok;
      }
    }

    const app = await bootstrapApplication({ providers: [Consumer, SlowDefault] });
    expect((app.get(Consumer) as Consumer).seen).toBe(true);
    await app.dispose();
  });
});

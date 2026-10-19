import { describe, expect, it } from "vitest";
import { bootstrapApplication, Injectable, inject, type Lifecycle } from "@morlay/zephyr";

describe("依赖等待", () => {
  it("依赖就绪后才进 onInit，与 providers 顺序无关", async () => {
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
    }

    @Injectable()
    class Consumer implements Lifecycle {
      store = inject(Store);

      onInit() {
        events.push(`consumer:${this.store.kind()}`);
      }
    }

    const app = await bootstrapApplication({ providers: [Consumer, PgStore] });
    expect(events).toEqual(["consumer:pg"]);
    await app.dispose();
  });
});

describe("卸载", () => {
  it("每个 provider 的 onDispose 都被调用", async () => {
    const disposed = new Set<string>();

    @Injectable()
    class A implements Lifecycle {
      onDispose() {
        disposed.add("a");
      }
    }

    @Injectable()
    class B implements Lifecycle {
      onDispose() {
        disposed.add("b");
      }
    }

    const app = await bootstrapApplication({ providers: [A, B] });
    await app.dispose();
    expect(disposed).toEqual(new Set(["a", "b"]));
  });

  it("只卸载本应用挂载的 fiber", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const ctx = new Context();
    ctx.plugin({
      name: "external",
      apply(c: any) {
        c.provide("external-svc", { ok: true });
      },
    });

    @Injectable()
    class Mine {}

    const app = await bootstrapApplication({ ctx, providers: [Mine] });
    await app.dispose();
    expect((ctx as any).get("external-svc")).toBeDefined();
  });
});

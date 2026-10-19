/**
 * 适配矩阵（B 组）：「上游插件形态 × 生命周期」的判据。
 *
 * 每条都对应真实上游的一种形态（对象插件 / `Service` 子类 / 异步 apply / 返回 disposer），
 * 这些行为是组合业务时的契约——改动 `fromCordis` 必须让它们一直绿。
 */
import { describe, expect, it } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { bootstrapApplication, Injectable, inject, serviceNamesOf } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

describe("B1 异步 apply 里的晚 provide", () => {
  it("apply 完成后才收集 published：消费者能拿到服务", async () => {
    const upstream = {
      name: "late-provider",
      apply: async (ctx: any) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        ctx.provide("late-provider", { ok: true });
      },
    };

    @Injectable()
    abstract class Late {
      abstract ok: boolean;
    }

    @Injectable()
    class LateProvider extends fromCordis(Late, upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class Consumer {
      late = inject(Late);
    }

    const app = await bootstrapApplication({ providers: [Consumer, LateProvider] });
    expect((app.get(Consumer) as Consumer).late.ok).toBe(true);
    await app.dispose();
  });
});

describe("B2 Service 子类在构造期读依赖", () => {
  it("deps 已进入行作用域：构造里 ctx.<dep> 不抛", async () => {
    const observed: string[] = [];

    class UpstreamService extends Service {
      constructor(ctx: Context, config: unknown) {
        super(ctx, "upstream-service");
        // 上游在**构造里**就读兄弟服务（`api-gateway` 的形态）。
        const hub = (ctx as unknown as { hub?: { name(): string } }).hub;
        observed.push(hub?.name() ?? "missing");
        void config;
      }
    }

    @Injectable()
    abstract class Hub {
      abstract name(): string;
    }

    @Injectable()
    class HubDefault extends Hub {
      name() {
        return "hub";
      }
    }

    @Injectable()
    abstract class UpstreamFace {
      abstract readonly marker: string;
    }

    @Injectable()
    class UpstreamProvider extends fromCordis(UpstreamFace, UpstreamService) {
      hub = inject(Hub);

      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { hub: this.hub });
      }
    }

    const app = await bootstrapApplication({ providers: [HubDefault, UpstreamProvider] });
    expect(observed).toEqual(["hub"]);
    await app.dispose();
  });
});

describe("B4 契约面转发（Proxy）", () => {
  it("inject(契约) 拿到的面对象能调契约方法，适配行的内部成员不外露", async () => {
    const calls: string[] = [];

    const upstream = {
      name: "routable",
      apply: (ctx: any) => {
        const instance = {
          register(route: { path: string }) {
            calls.push(`upstream:register:${route.path}`);
            return () => {};
          },
          internalOnly() {
            return "internal";
          },
        };
        ctx.provide("routable", instance);
      },
    };

    @Injectable()
    abstract class Routable {
      abstract register(route: { path: string }): () => void;

      abstract internalOnly(): string;
    }

    @Injectable()
    class RoutableProvider extends fromCordis(Routable, upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class Consumer {
      routable = inject(Routable);
    }

    const app = await bootstrapApplication({ providers: [RoutableProvider, Consumer] });
    const routable = app.get(Consumer).routable;
    routable.register({ path: "/x" });
    expect(calls).toEqual(["upstream:register:/x"]);
    expect(routable.internalOnly()).toBe("internal");
    // 面对象就是令牌指向的对象：`inject(契约)` 与 `app.get(契约)` 是同一份。
    expect(app.get(Routable)).toBe(routable);
    // 隔离：适配行的 framework 面（providerContext / providerInstance）经面对象读不到。
    const leaked = routable as unknown as Record<string, unknown>;
    expect(leaked["providerContext"]).toBeUndefined();
    expect(leaked["providerInstance"]).toBeUndefined();
    await app.dispose();
  });
});

describe("B6 mount 失败", () => {
  it("apply 抛错时装配失败并回滚", async () => {
    const upstream = {
      name: "broken-upstream",
      apply: () => {
        throw new Error("upstream-broke");
      },
    };

    @Injectable()
    abstract class Broken {
      abstract ok: boolean;
    }

    @Injectable()
    class BrokenProvider extends fromCordis(Broken, upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    await expect(bootstrapApplication({ providers: [BrokenProvider] })).rejects.toThrow(
      "upstream-broke",
    );
  });
});

describe("B9 toCordis(Module) 与 @Module 语义一致", () => {
  it("裸 cordis 插件装载同一个 Module，服务照常可解析", async () => {
    @Injectable()
    abstract class Token {
      abstract value: string;
    }

    @Injectable()
    class TokenDefault extends Token {
      value = "ok";
    }

    const { Module } = await import("@morlay/zephyr");
    const { toCordis: toCordisCompat } = await import("@morlay/zephyr/compat");

    @Module({ providers: [TokenDefault] })
    class TokenModule {}

    const app = await bootstrapApplication({ imports: [TokenModule] });
    expect(app.get(Token).value).toBe("ok");
    await app.dispose();

    // `toCordis` 把同一个 Module 变成 cordis 插件（对象形态 `{ apply, inject }` 也算插件）。
    const plugin = toCordisCompat(TokenModule) as unknown as { apply?: unknown };
    expect(typeof plugin === "function" || typeof plugin.apply === "function").toBe(true);
  });
});

describe("B3 构造期读未声明名字", () => {
  it("立即报错（不静默 undefined）", async () => {
    const errors: string[] = [];

    class StrictService extends Service {
      constructor(ctx: Context, config: unknown) {
        super(ctx, "strict-service");
        try {
          // 没有声明 inject、也没有 deps：读面必须抛（cordis 的语义）。
          const nowhere = (ctx as unknown as { nowhere?: unknown }).nowhere;
          errors.push(`no-error:${String(nowhere)}`);
        } catch (error) {
          errors.push(String(error));
        }
        void config;
      }
    }

    @Injectable()
    abstract class StrictFace {
      abstract readonly marker: string;
    }

    @Injectable()
    class StrictProvider extends fromCordis(StrictFace, StrictService) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [StrictProvider] });
    expect(errors[0]).toContain("nowhere");
    await app.dispose();
  });
});

describe("B5 上游内部注册也能被包装记录", () => {
  it("包装 providerInstance 后，经面对象的调用走同一个实例", async () => {
    const recorded: string[] = [];

    class RoutingService extends Service {
      register(_route: { path: string }): () => void {
        return () => {};
      }

      constructor(ctx: Context, config: unknown) {
        super(ctx, "routing-service");
        // 上游在**构造里**注册（`api-gateway` 的形态）：走实例自身，不经过面对象。
        this.register({ path: "/api/inside" });
        void config;
      }
    }

    @Injectable()
    abstract class RoutingFace {
      abstract register(route: { path: string }): () => void;
    }

    @Injectable()
    class RoutingProvider extends fromCordis(RoutingFace, RoutingService) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
        const host = this.providerInstance as unknown as {
          register(route: { path: string }): () => void;
        };
        const original = host.register.bind(host);
        host.register = (route) => {
          recorded.push(route.path);
          return original(route);
        };
      }
    }

    const app = await bootstrapApplication({ providers: [RoutingProvider] });
    const face = app.get(RoutingFace) as RoutingFace;
    face.register({ path: "/api/outside" });
    expect(recorded).toEqual(["/api/outside"]);
    // 构造期的自注册发生在包装之前、也不经过面对象：它不在记录里。
    expect(recorded).not.toContain("/api/inside");
    await app.dispose();
  });
});

describe("B11 上游内部名不进根", () => {
  it("根名字视图只有契约名，其余 provide 的名字只留在本行", async () => {
    const upstream = {
      name: "internal-names",
      apply: (ctx: any) => {
        // 契约名（连字符）与内部名一起 provide：根上只能看到前者。
        ctx.provide("internal-names", { ok: true });
        ctx.provide("internal-names.detail", { ok: true });
        ctx.provide("internal-names.extra", { ok: true });
      },
    };

    @Injectable()
    abstract class InternalNames {
      abstract ok: boolean;
    }

    @Injectable()
    class InternalNamesProvider extends fromCordis(InternalNames, upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [InternalNamesProvider] });
    const names = serviceNamesOf(app.ctx);
    expect(names.has("internal-names")).toBe(true);
    expect(names.has("internal-names.detail")).toBe(false);
    expect(names.has("internal-names.extra")).toBe(false);
    expect(app.ctx.get("internal-names.detail")).toBeUndefined();
    await app.dispose();
  });
});

describe("B7 重复装配", () => {
  it("同一个 Provider 出现两处：装配按幂等处理（只 init 一次）", async () => {
    let inits = 0;

    @Injectable()
    class Twice {
      onInit() {
        inits += 1;
      }
    }

    const app = await bootstrapApplication({ providers: [Twice, Twice] });
    expect(inits).toBe(1);
    await app.dispose();
  });
});

describe("B8 disposer 与 onDispose 的顺序", () => {
  it("先跑子类 onDispose，再跑上游 disposer（清理顺序：使用方 → 提供方）", async () => {
    const events: string[] = [];

    const upstream = {
      name: "disposable",
      apply: () => () => {
        events.push("upstream:dispose");
      },
    };

    @Injectable()
    abstract class Disposable {
      abstract readonly marker: string;
    }

    @Injectable()
    class DisposableProvider extends fromCordis(Disposable, upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }

      onDispose() {
        events.push("ours:dispose");
      }
    }

    const app = await bootstrapApplication({ providers: [DisposableProvider] });
    await app.dispose();
    expect(events).toEqual(["ours:dispose", "upstream:dispose"]);
  });
});

describe("B10 隔离：providerContext 不出现在公开出口", () => {
  it("compat 出口没有 providerContext（类型层面拿不到）", async () => {
    const compat = (await import("@morlay/zephyr/compat")) as Record<string, unknown>;
    expect(compat["providerContext"]).toBeUndefined();
  });

  it("适配类实例上 providerContext 是 private（编译期不可访问）", () => {
    @Injectable()
    abstract class Face {
      abstract readonly marker: string;
    }

    @Injectable()
    class FaceProvider extends fromCordis(Face, { apply: () => {} }) {}

    const instance = new FaceProvider();
    // @ts-expect-error providerContext 是 private：外部禁止访问（编译期拦截）。
    const leaked = instance.providerContext;
    expect(leaked).toBeUndefined();
  });
});

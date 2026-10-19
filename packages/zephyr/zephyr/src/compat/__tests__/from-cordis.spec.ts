import { describe, expect, it } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { bootstrapApplication, Injectable, inject, serviceNamesOf } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

describe("适配型 Provider 挂载上游插件", () => {
  it("对象插件：config 经 of() 透传，插件注册的服务用 inject(令牌) 取用", async () => {
    const upstream = {
      name: "session-query-sqlite",
      apply: (ctx: any, config: { prefix?: string }) => {
        ctx.provide("session-query-sqlite", {
          query: (id: string) => `${config.prefix ?? "result"}:${id}`,
        });
      },
    };

    @Injectable()
    abstract class SessionQuery {
      abstract query(id: string): string;
    }

    @Injectable()
    class QueryProvider extends fromCordis(SessionQuery, upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class Reporter {
      query = inject(SessionQuery);
      seen: string[] = [];

      onInit() {
        this.seen.push(this.query.query("a"));
      }
    }

    const app = await bootstrapApplication({
      providers: [{ provide: QueryProvider, useValue: { prefix: "ok" } }, Reporter],
    });
    expect(app.get(Reporter).seen).toEqual(["ok:a"]);
    await app.dispose();
  });

  it("class 插件：new Class(ctx, config) + Config 归一化 + initHooks 激活", async () => {
    const INIT_HOOKS = Symbol.for("cordis.initHooks");
    const INIT = Symbol.for("cordis.init");

    class GreeterService {
      static Config = (value: unknown) => ({
        greeting: "hello",
        ...(value as object),
      });
      greeting: string;

      constructor(
        public ctx: Context,
        config: { greeting: string },
      ) {
        this.greeting = config.greeting;
        Object.assign(this, { [INIT_HOOKS]: [] });
      }

      [INIT]() {
        this.ctx.provide("greeter", {
          greet: (name: string) => `${this.greeting}, ${name}`,
        });
      }
    }

    @Injectable()
    abstract class Greeter {
      abstract greet(name: string): string;
    }

    @Injectable()
    class GreeterProvider extends fromCordis(Greeter, GreeterService) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class User {
      greeter = inject(Greeter);
      greeted: string[] = [];

      onInit() {
        this.greeted.push(this.greeter.greet("zephyr"));
      }
    }

    const app = await bootstrapApplication({
      providers: [{ provide: GreeterProvider, useValue: { greeting: "hi" } }, User],
    });
    expect(app.get(User).greeted).toEqual(["hi, zephyr"]);
    await app.dispose();
  });

  it("Provider 声明的依赖先等就绪：上游插件访问该服务属性，与挂载顺序无关", async () => {
    const applied: string[] = [];

    const upstream = {
      name: "upstream-consumer",
      inject: ["session-query-sqlite"] as const,
      apply: (ctx: any) => {
        applied.push("upstream-consumer");
        ctx.provide("upstream-consumer", {
          run: () => ctx["session-query-sqlite"].query("x"),
        });
      },
    };

    const dependency = {
      name: "session-query-sqlite",
      apply: (ctx: any) => {
        ctx.provide("session-query-sqlite", {
          query: (id: string) => `row:${id}`,
        });
      },
    };

    @Injectable()
    abstract class UpstreamConsumer {
      abstract run(): string;
    }

    @Injectable()
    abstract class SessionQuery {
      abstract query(id: string): string;
    }

    @Injectable()
    class ConsumerProvider extends fromCordis(UpstreamConsumer, upstream) {
      sessionQuery = inject(SessionQuery);

      async onInit(ctx: Context) {
        await this.mount(ctx, undefined, { "session-query-sqlite": this.sessionQuery });
      }
    }

    @Injectable()
    class QueryProvider extends fromCordis(SessionQuery, dependency) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    let result = "";
    @Injectable()
    class Reporter {
      consumer = inject(UpstreamConsumer);

      onInit() {
        result = this.consumer.run();
      }
    }

    const app = await bootstrapApplication({
      providers: [ConsumerProvider, QueryProvider, Reporter],
    });
    expect(result).toBe("row:x");
    expect(applied).toEqual(["upstream-consumer"]);
    await app.dispose();
  });

  it("key 与上游访问一致：Provider 声明 inject(令牌)，上游即可访问该服务", async () => {
    const seen: string[] = [];
    const upstream = {
      name: "token-consumer",
      apply: (ctx: any) => {
        seen.push(ctx["token-service"]);
      },
    };
    const dependency = {
      name: "token-service",
      apply: (ctx: any) => {
        ctx.provide("token-service", "ready");
      },
    };

    @Injectable()
    abstract class TokenService {
      abstract value: string;
    }

    @Injectable()
    class ConsumerProvider extends fromCordis(upstream) {
      tokenService = inject(TokenService);

      async onInit(ctx: Context) {
        await this.mount(ctx, undefined, { "token-service": this.tokenService });
      }
    }

    @Injectable()
    class TokenServiceProvider extends fromCordis(TokenService, dependency) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({
      providers: [ConsumerProvider, TokenServiceProvider],
    });
    expect(seen).toEqual(["ready"]);
    await app.dispose();
  });
});

describe("适配型 Provider 的卸载", () => {
  it("插件返回的 disposer 在应用卸载时被调用", async () => {
    const log: string[] = [];
    const upstream = {
      name: "disposable",
      apply: () => () => log.push("disposed"),
    };

    @Injectable()
    class Disposable extends fromCordis(upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [Disposable] });
    expect(log).toEqual([]);
    await app.dispose();
    expect(log).toEqual(["disposed"]);
  });

  it("子类自定义 onDispose 时，插件的清理仍然执行", async () => {
    const log: string[] = [];
    const upstream = {
      name: "cleanup-probe",
      apply: () => () => log.push("plugin-disposed"),
    };

    @Injectable()
    class CleanupProbe extends fromCordis(upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }

      override onDispose(): void {
        log.push("provider-disposed");
      }
    }

    const app = await bootstrapApplication({ providers: [CleanupProbe] });
    await app.dispose();
    expect(log).toContain("plugin-disposed");
    expect(log).toContain("provider-disposed");
  });

  it("不写 onInit 就不挂载：挂载由 Provider 显式发起", async () => {
    let applied = false;
    const upstream = {
      name: "not-mounted",
      apply: () => {
        applied = true;
      },
    };

    @Injectable()
    class NotMounted extends fromCordis(upstream) {}

    const app = await bootstrapApplication({ providers: [NotMounted] });
    expect(applied).toBe(false);
    await app.dispose();
  });
});

describe("适配型 Provider 的身份", () => {
  it("代理之后令牌就是 Provider 类自身，实例类型带上游服务形状", async () => {
    class UpstreamService extends Service {
      constructor(ctx: Context) {
        super(ctx, "probe-service");
      }

      ping(): string {
        return "pong";
      }
    }

    @Injectable()
    class ProbeService extends fromCordis(UpstreamService) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class Consumer {
      probe = inject(ProbeService);
      seen = "";

      onInit() {
        this.seen = this.probe.ping();
      }
    }

    const app = await bootstrapApplication({
      providers: [ProbeService, Consumer],
    });
    expect(app.get(Consumer).seen).toBe("pong");
    expect(app.get(ProbeService)).toBe(app.get(Consumer).probe);
    await app.dispose();
  });

  it("不注册自身：服务名只作插件名，服务由上游插件注册", async () => {
    const upstream = { name: "hidden", apply: () => {} };

    @Injectable()
    class Hidden extends fromCordis(upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [Hidden] });
    expect(() => app.get(Hidden)).toThrow(/is not available/);
    await app.dispose();
  });

  it("仍参与生命周期", async () => {
    const events: string[] = [];
    const upstream = { name: "lifecycle-probe", apply: () => {} };

    @Injectable()
    class LifecycleProbe extends fromCordis(upstream) {
      protected override async onInit(ctx: Context): Promise<void> {
        events.push("init");
        await this.mount(ctx);
      }

      override onDispose(): void {
        events.push("dispose");
      }
    }

    const app = await bootstrapApplication({ providers: [LifecycleProbe] });
    expect(events).toEqual(["init"]);
    await app.dispose();
    expect(events).toEqual(["init", "dispose"]);
  });
});

describe("名字视图：被挂载的上游插件之间的服务名通道", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("上游 provide 的名字只在本行可读，根名字视图里只有契约名", async () => {
    const seen: Record<string, unknown> = {};

    const policy = {
      name: "policy-provider",
      apply: (ctx: any) => {
        ctx.provide("policy-store", { mode: "strict" });
        seen.prop = ctx["policy-store"];
        seen.get = ctx.get("policy-store");
        seen.fallback = ctx.get("absent", "fallback");
        ctx.inject(["policy-store"], (childCtx: any) => {
          seen.injected = childCtx["policy-store"];
        });
      },
    };

    @Injectable()
    abstract class Policy {
      abstract mode: string;
    }

    @Injectable()
    class PolicyProvider extends fromCordis(Policy, policy) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class Reporter {
      policy = inject(Policy);
    }

    const app = await bootstrapApplication({
      providers: [PolicyProvider, Reporter],
    });
    await tick();
    expect(seen.prop).toEqual({ mode: "strict" });
    expect(seen.get).toEqual({ mode: "strict" });
    expect(seen.fallback).toBe("fallback");
    expect(seen.injected).toEqual({ mode: "strict" });

    // 契约面：`inject(契约)` 拿到的是面对象，读得到契约声明的成员。
    expect(app.get(Reporter).policy.mode).toBe("strict");
    // 根名字视图只由契约名贡献：上游内部名（`policy-store`）不在。
    const rootNames = serviceNamesOf(app.ctx);
    expect(rootNames.has("policy-store")).toBe(false);
    expect(rootNames.has("policy")).toBe(true);
    await app.dispose();
  });

  it("名字晚到时 ctx.inject 仍激活；返回的 fiber 可 await 且有 dispose", async () => {
    const log: string[] = [];
    let fiber: (Promise<unknown> & { dispose(): void }) | undefined;

    const late = {
      name: "late-provider",
      apply: (ctx: any) => {
        log.push("provided");
        ctx.provide("late", "x");
      },
    };
    const consumer = {
      name: "late-consumer",
      apply: (ctx: any) => {
        // 跨行等的是**契约名**（`late`）：上游内部名不进根。
        fiber = ctx.inject(["late"], (childCtx: any) => {
          log.push(`injected:${childCtx.late}`);
        });
      },
    };

    @Injectable()
    abstract class Late {
      abstract readonly ok: string;
    }

    @Injectable()
    class LateConsumer extends fromCordis(consumer) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    @Injectable()
    class LateProvider extends fromCordis(Late, late) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({
      providers: [LateConsumer, LateProvider],
    });
    await fiber;
    expect(log).toEqual(["provided", "injected:x"]);
    expect(typeof fiber?.dispose).toBe("function");
    await app.dispose();
  });

  it("等待的名字永不到来时，ctx.inject 的回调不触发，也不阻塞启动", async () => {
    let called = false;
    const upstream = {
      name: "ghost-consumer",
      apply: (ctx: any) => {
        ctx.inject(["ghost"], () => {
          called = true;
        });
      },
    };

    @Injectable()
    class GhostConsumer extends fromCordis(upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({
      providers: [GhostConsumer],
      timeoutMs: 50,
    });
    await tick();
    expect(called).toBe(false);
    await app.dispose();
  });

  it("名字视图只对上游插件开放：消费侧读属性仍是 cordis 语义", async () => {
    const policy = {
      name: "policy-provider",
      apply: (ctx: any) => ctx.provide("policy", { mode: "strict" }),
    };

    @Injectable()
    class PolicyProvider extends fromCordis(policy) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    let message = "";
    @Injectable()
    class Consumer {
      onInit(ctx: Context) {
        try {
          const read = () => (ctx as unknown as Record<string, unknown>)["policy"];
          read();
        } catch (error) {
          message = (error as Error).message;
        }
      }
    }

    const app = await bootstrapApplication({
      providers: [PolicyProvider, Consumer],
    });
    expect(message).toMatch(/cannot get property "policy" without inject/);
    await app.dispose();
  });
});

describe("依赖声明与上游访问的一致性", () => {
  it("上游访问了没声明的服务属性时，启动即报错并指出该 key", async () => {
    const upstream = {
      name: "needs-undeclared",
      apply: (ctx: any) => {
        return ctx["undeclared-svc"];
      },
    };

    @Injectable()
    class NeedsUndeclared extends fromCordis(upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    await expect(bootstrapApplication({ providers: [NeedsUndeclared] })).rejects.toThrow(
      /needs-undeclared: cannot get property "undeclared-svc" without inject/,
    );
  });
});

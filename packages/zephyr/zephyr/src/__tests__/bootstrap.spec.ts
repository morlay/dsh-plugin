import { describe, expect, it } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { bootstrapApplication, configuredProvider, Injectable, inject, Module, without } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { contribute, withConfig, type ProviderList } from "@morlay/zephyr";

describe("装配", () => {
  it("providers 接收 @Injectable 的类，服务可以在启动后取用", async () => {
    @Injectable()
    class Settings {
      value = "default";
    }

    const app = await bootstrapApplication({ providers: [Settings] });
    expect(app.get(Settings).value).toBe("default");
    await app.dispose();
  });

  it("Provider.withConfig 按 Provider 的构造参数推导配置类型", async () => {
    @Injectable()
    class Grouped {
      static readonly withConfig = withConfig;

      readonly label: string;

      constructor(label = "") {
        this.label = label;
      }
    }

    const configured = Grouped.withConfig("a");

    // @ts-expect-error 故意构造：配置值类型不符
    const wrong = Grouped.withConfig(1);

    const app = await bootstrapApplication({ providers: [configured] });
    expect(app.get(Grouped).label).toBe("a");
    expect(wrong).toBeDefined();
    await app.dispose();
  });

  it("适配型 Provider 由 fromCordis 带上同一个 withConfig 静态", async () => {
    const upstream = {
      name: "upstream-service",
      apply: (ctx: Context) => {
        ctx.provide("upstream-service", {});
      },
    };

    @Injectable()
    class Adapted extends fromCordis(upstream) {}

    // 适配行同样能用 `withConfig`：返回的是**绑定配置的子类**（构造参数拿到 config）。
    const configured = Adapted.withConfig({ any: "config" }) as unknown as {
      readonly providerBase: unknown;
    };
    expect(configured).not.toBe(Adapted);
    expect(configured.providerBase).toBe(Adapted);
  });

  it("传入已有 ctx 时挂在其上，装配者可继续用 ctx 与插件树交互", async () => {
    const ctx = new Context();
    let served = "";

    @Injectable()
    class Server {
      onInit() {
        ctx.provide("assembled", { hello: () => "world" });
      }
    }

    const app = await bootstrapApplication({ ctx, providers: [Server] });
    served = (ctx.get("assembled") as { hello: () => string }).hello();
    expect(served).toBe("world");
    await app.dispose();
  });

  it("继承 Cordis Service 的 Provider：构造拿 ctx 与配置，服务按名字原生注册，其余依赖照常注入", async () => {
    @Injectable()
    class Settings {
      value = "injected";
    }

    class PersistenceBase extends Service {
      readonly settings: Settings;

      constructor(ctx: Context, readonly config: { path: string }) {
        super(ctx, "probePersistence");
        this.settings = inject(Settings);
      }
    }

    @Injectable()
    class ProbePersistence extends PersistenceBase {}

    const ctx = new Context();
    const app = await bootstrapApplication({
      ctx,
      providers: [Settings, { provide: ProbePersistence, useValue: { path: ":memory:" } }],
    });
    const viaName = ctx.get("probePersistence") as ProbePersistence;
    expect(viaName).toBeInstanceOf(ProbePersistence);
    expect(viaName.config.path).toBe(":memory:");
    expect(viaName.settings.value).toBe("injected");
    await app.dispose();
  });

  it("configuredProvider 也能配继承 Service 的 Provider：ctx 与配置都到构造", async () => {
    class Base extends Service {
      constructor(ctx: Context, readonly config: { path: string }) {
        super(ctx, "configuredService");
      }
    }

    @Injectable()
    class ConfiguredService extends Base {}

    const Configured = configuredProvider(ConfiguredService, { path: "configured" });
    const ctx = new Context();
    const app = await bootstrapApplication({ ctx, providers: [Configured] });
    const viaName = ctx.get("configuredService") as ConfiguredService;
    expect(viaName).toBeInstanceOf(ConfiguredService);
    expect(viaName.config.path).toBe("configured");
    await app.dispose();
  });
});

describe("启动收敛", () => {
  it("含真实 I/O 的适配插件能完成启动", async () => {
    const slow = {
      name: "slow-svc",
      apply: async (ctx: any) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        ctx.provide("slow-svc", { ok: true });
      },
    };

    @Injectable()
    abstract class Slow {
      abstract ok: boolean;
    }

    @Injectable()
    class SlowProvider extends fromCordis(Slow, slow) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    let ready = false;
    @Injectable()
    class Consumer {
      svc = inject(Slow);

      onInit() {
        ready = this.svc.ok;
      }
    }

    const app = await bootstrapApplication({
      providers: [SlowProvider, Consumer],
    });
    expect(ready).toBe(true);
    await app.dispose();
  });
});

describe("app.get 的语义", () => {
  it("未注册的服务立即报错，而不是返回 undefined", async () => {
    @Injectable()
    class Never {}

    const app = await bootstrapApplication({ providers: [] });
    expect(() => app.get(Never)).toThrow(/is not available/);
    await app.dispose();
  });

  it("传入非令牌时报错清晰", async () => {
    const app = await bootstrapApplication({ providers: [] });
    expect(() => app.get(undefined as never)).toThrow(/expected a token class/);
    await app.dispose();
  });
});

describe("裸 cordis 插件：直接作为 providers 的一项", () => {
  it("挂载插件，卸载时跑它返回的清理函数", async () => {
    const log: string[] = [];
    const raw = {
      name: "raw-plugin",
      apply: (ctx: Context) => {
        log.push("applied");
        ctx.provide("raw-service", { ok: true });
        return () => log.push("disposed");
      },
    };
    const nested = {
      name: "nested-plugin",
      apply: () => {
        log.push("nested");
      },
    };

    const app = await bootstrapApplication({
      providers: [raw, nested],
    });
    expect(log).toEqual(["applied", "nested"]);
    await app.dispose();
    expect(log).toEqual(["applied", "nested", "disposed"]);
  });

  it("插件按服务名读到 Provider 提供的服务，并等它就绪", async () => {
    const items: string[] = [];
    const upstream = {
      name: "registry",
      apply: (ctx: Context) => {
        ctx.provide("registry", {
          register: (item: string) => items.push(item),
        });
      },
    };

    @Injectable()
    abstract class Registry {
      abstract register(item: string): void;
    }

    @Injectable()
    class RegistryProvider extends fromCordis(Registry, upstream) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    const user = {
      name: "registry-user",
      inject: ["registry"],
      apply: (ctx: Context) => {
        (ctx as unknown as { registry: Registry }).registry.register("from-plugin");
      },
    };

    const app = await bootstrapApplication({
      providers: [RegistryProvider, user],
    });
    expect(items).toEqual(["from-plugin"]);
    await app.dispose();
  });
});

describe("@Module：批量组合", () => {
  it("imports 先展开，随后是本模块的 providers 与 use；imports 可嵌套", async () => {
    const log: string[] = [];

    @Injectable()
    class Shared {
      label = "shared";
    }

    const inner = {
      name: "inner-plugin",
      apply: (ctx: Context) => {
        log.push("inner");
        ctx.provide("inner-service", 1);
      },
    };

    @Module({ providers: [inner] })
    class InnerModule {}

    @Injectable()
    class Consumer {
      shared = inject(Shared);
      label = "";

      onInit() {
        this.label = this.shared.label;
      }
    }

    @Module({ imports: [InnerModule], providers: [Shared, Consumer] })
    class CoreModule {}

    @Injectable()
    class Other {
      value = 1;
    }

    const app = await bootstrapApplication({
      imports: [CoreModule],
      providers: [Other],
    });
    expect(log).toEqual(["inner"]);
    expect(app.get(Consumer).label).toBe("shared");
    expect(app.get(Other).value).toBe(1);
    await app.dispose();
  });

  it("withConfig：参数化分组返回的 ProviderList 当 providers 的一项", async () => {
    const log: string[] = [];

    @Injectable()
    class Grouped {
      readonly label: string;

      constructor(label = "") {
        this.label = label;
      }
    }

    const plugin = (label: string) => ({
      name: `grouped-plugin-${label}`,
      apply: () => {
        log.push(label);
      },
    });

    @Module()
    class GroupedModule {
      static withConfig(label: string): ProviderList {
        return [{ provide: Grouped, useValue: label }, plugin(label)];
      }
    }

    const app = await bootstrapApplication({
      providers: [GroupedModule.withConfig("a")],
    });
    expect(app.get(Grouped).label).toBe("a");
    expect(log).toEqual(["a"]);
    await app.dispose();
  });

  it("未装饰 @Module() 的类当模块用时报错清晰", async () => {
    class NotAModule {}

    await expect(bootstrapApplication({ providers: [{ useModule: NotAModule }] })).rejects.toThrow(
      /"NotAModule" is not a module; apply @Module\(\) to it/,
    );
  });
});

describe("multi：多值贡献", () => {
  it("同一令牌登记多份，inject.all / app.getAll 取全部，卸载后撤销", async () => {
    @Injectable()
    abstract class Section {
      abstract name: string;
    }

    @Injectable()
    class Consumer {
      sections = inject.all(Section);
    }

    const app = await bootstrapApplication({
      providers: [
        contribute(Section, { name: "prefix" }),
        contribute(Section, { name: "suffix" }),
        Consumer,
      ],
    });
    expect(app.get(Consumer).sections.map((section) => section.name)).toEqual(["prefix", "suffix"]);
    expect(app.getAll(Section).map((section) => section.name)).toEqual(["prefix", "suffix"]);
    await app.dispose();
    expect(app.getAll(Section)).toEqual([]);
  });

  it("multi 令牌用 inject() 读时提示改用 inject.all()", async () => {
    @Injectable()
    abstract class Section {
      abstract name: string;
    }

    @Injectable()
    class Consumer {
      section = inject(Section);
    }

    await expect(
      bootstrapApplication({
        providers: [{ provide: Section, useValue: { name: "a" }, multi: true }, Consumer],
      }),
    ).rejects.toThrow(/use inject\.all\(\)/);
  });
});

describe("启动失败的诊断信息", () => {
  it("依赖在装配里没人提供时，立刻指出 provider 与缺失的服务", async () => {
    @Injectable()
    abstract class Missing {
      abstract y(): void;
    }

    @Injectable()
    class Consumer {
      dep = inject(Missing);
    }

    const started = Date.now();
    await expect(bootstrapApplication({ providers: [Consumer], timeoutMs: 50 })).rejects.toThrow(
      /consumer: service "missing" is not available/,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("插件抛错时，指出 provider 与错误原因", async () => {
    const broken = {
      name: "broken",
      apply: () => {
        throw new Error("boom");
      },
    };

    @Injectable()
    class Broken extends fromCordis(broken) {
      async onInit(ctx: Context) {
        await this.mount(ctx);
      }
    }

    await expect(bootstrapApplication({ providers: [Broken] })).rejects.toThrow(/broken: boom/);
  });

  it("抛错的 provider 还有人等：立刻失败并给出原因，不把错误等成超时", async () => {
    @Injectable()
    class Boom {
      constructor() {
        throw new Error("装配期炸了");
      }
    }

    @Injectable()
    class WaitsOnBoom {
      // 它会一直等 Boom 的令牌——「等」不能把「错」也等掉（否则这里只剩超时，真实原因被吞掉）
      dep = inject(Boom);
    }

    const started = Date.now();
    await expect(
      bootstrapApplication({ providers: [Boom, WaitsOnBoom], timeoutMs: 5000 }),
    ).rejects.toThrow(/boom: 装配期炸了/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("Module 合并剔除", () => {
  it("without 在合并时剔除 Provider", async () => {
    @Injectable()
    class Keep {
      readonly label = "keep";
    }

    @Injectable()
    class Drop {
      readonly label = "drop";
    }

    @Module({ providers: [Keep, without(Drop)] })
    class Base {}

    const app = await bootstrapApplication({ providers: [Base] });
    try {
      expect(app.get(Keep).label).toBe("keep");
      expect(app.tryGet(Drop)).toBeUndefined();
    } finally {
      await app.dispose();
    }
  });
});

describe("Module 覆盖 Provider", () => {
  it("后 Module 的同 token Provider 覆盖前一个", async () => {
    @Injectable()
    class Value {
      constructor(readonly label: string) {}
    }

    const FirstValue = configuredProvider(Value, "first");
    const SecondValue = configuredProvider(Value, "second");
    @Module({ providers: [FirstValue] })
    class First {}

    @Module({ imports: [First], providers: [SecondValue] })
    class Second {}

    const app = await bootstrapApplication({ providers: [Second] });
    try {
      expect(app.get(Value).label).toBe("second");
    } finally {
      await app.dispose();
    }
  });
});

describe("App.instantiate（运行时实例化）", () => {
  it("未装配的类也能在运行期拿到字段注入，且不会被注册成服务", async () => {
    @Injectable()
    class Settings {
      readonly label = "settings";
    }

    class Page {
      settings = inject(Settings);

      build(): string {
        return this.settings.label;
      }
    }

    const app = await bootstrapApplication({ providers: [Settings] });
    const page = app.instantiate(Page);
    expect(page.build()).toBe("settings");
    expect(app.tryGet(Page)).toBeUndefined();
    await app.dispose();
  });

  it("缺失的必需依赖保留占位：访问时报错，而不是静默 undefined", async () => {
    @Injectable()
    abstract class Missing {
      abstract y(): void;
    }

    class Page {
      missing = inject(Missing);

      read(): unknown {
        return (this.missing as { label?: string }).label;
      }
    }

    const app = await bootstrapApplication({ providers: [] });
    const page = app.instantiate(Page);
    expect(() => page.read()).toThrow();
    await app.dispose();
  });
});

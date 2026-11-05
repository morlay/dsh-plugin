import { describe, expect, it } from "vitest";
import {
  bootstrapApplication,
  Injectable,
  inject,
  type Context,
  type TokenClass,
} from "../../index.ts";
import { fromCordis } from "../index.ts";

/** 契约：上游服务的类型面。 */
@Injectable()
abstract class Greeter {
  abstract greet(): string;
}

/** 上游要的依赖（由装配面显式给）。 */
@Injectable()
class LocaleRow {
  readonly hello = "你好";
}

/**
 * cordis `Service` 的**测试替身**：`isServiceClass` 用鸭子类型判断（静态 `init` 符号），
 * 所以替身不需要真的继承 cordis 的 `Service`——那样还会把 vendor 的类型依赖带进 spec。
 */
class FakeService {
  static readonly init: unique symbol = Symbol("service.init");

  constructor(ctx: never, name: string) {
    (ctx as unknown as { reflect: { provide(name: string, value: unknown): void } }).reflect.provide(
      name,
      this,
    );
  }
}

describe("fromCordis", () => {
  it("契约 + 上游：上游发布的服务成为契约面，deps 只在读取时替换", async () => {
    /** 上游插件：读一个依赖，发布一个服务。 */
    const upstream = {
      name: "upstream-greeter",
      inject: ["locale"],
      apply: (ctx: unknown) => {
        const cordis = ctx as { get(name: string): unknown; provide(name: string, value: unknown): void };
        const locale = cordis.get("locale") as { hello: string };
        cordis.provide("greeter", { greet: () => locale.hello });
      },
    };

    /** 适配行。 */
    @Injectable()
    class GreeterRow extends fromCordis(Greeter, upstream) {
      private readonly locale = inject(LocaleRow);

      // 适配行的 `onInit` 用 `override`：基类声明了它，子类才 override 得合法。
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.locale });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, GreeterRow] });
    try {
      expect(app.get<Greeter>(Greeter).greet(), "契约面就是上游发布的服务").toBe("你好");
      const stored = (app.ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
        "locale",
        false,
      );
      expect(stored, "deps 不进 cordis store").toBeUndefined();
    } finally {
      await app.dispose();
    }
  });

  it("上游用 `ctx.inject` 等 deps 时也走替换（不会一直等 cordis store）", async () => {
    /** 上游插件：用 inject 回调消费依赖。 */
    const upstream = {
      name: "upstream-injecting",
      inject: ["locale"],
      apply: (ctx: unknown) => {
        const cordis = ctx as {
          inject(names: readonly string[], callback: (scoped: unknown) => void): void;
        };
        cordis.inject(["locale"], (scoped) => {
          const locale = (scoped as { locale: { hello: string } }).locale;
          (scoped as { provide(name: string, value: unknown): void }).provide("greeter", {
            greet: () => locale.hello,
          });
        });
      },
    };

    /** 适配行。 */
    @Injectable()
    class GreeterRow extends fromCordis(Greeter, upstream) {
      private readonly locale = inject(LocaleRow);

      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.locale });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, GreeterRow] });
    try {
      expect(app.get<Greeter>(Greeter).greet(), "inject 回调拿到的也是 deps").toBe("你好");
    } finally {
      await app.dispose();
    }
  });

  it("契约名与上游注册名不同时，按上游实际发布的名字取面", async () => {
    /** 上游插件：注册名与契约的连字符名不一致（真实场景就是这样）。 */
    const upstream = {
      name: "session-store-upstream",
      apply: (ctx: unknown) => {
        (ctx as { provide(name: string, value: unknown): void }).provide("sessions", {
          list: () => ["s1"],
        });
      },
    };

    /** 契约：`SessionStore` → 连字符名 `session-store`，与上游的 `sessions` 不同。 */
    @Injectable()
    abstract class SessionStore {
      abstract list(): string[];
    }

    /** 适配行。 */
    @Injectable()
    class SessionStoreRow extends fromCordis(SessionStore, upstream) {
      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [SessionStoreRow] });
    try {
      expect(app.get<SessionStore>(SessionStore).list(), "取到的是上游实例").toEqual(["s1"]);
    } finally {
      await app.dispose();
    }
  });

  it("单入参（无契约）：令牌从上游插件名派生，`Adapted.token` 就是它", async () => {
    /** 上游插件：发布服务。 */
    const upstream = {
      name: "plain-upstream",
      apply: (ctx: unknown) => {
        (ctx as { provide(name: string, value: unknown): void }).provide("plain-upstream", {
          value: 7,
        });
      },
    };

    /** 无契约的适配基类。 */
    const Adapted = fromCordis(upstream);

    /** 适配行。 */
    @Injectable()
    class PlainRow extends Adapted {
      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [PlainRow] });
    try {
      const face = app.get(Adapted.token as unknown as TokenClass<{ value: number }>);
      expect(face.value, "契约面就是上游发布的服务").toBe(7);
    } finally {
      await app.dispose();
    }
  });

  it("只有契约（纯实现）：没有上游可装，子类自己实现契约方法", async () => {
    /** 纯实现行：`mount` 什么都不做。 */
    @Injectable()
    class GreeterRow extends fromCordis(Greeter) {
      greet(): string {
        return "纯实现";
      }

      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [GreeterRow] });
    try {
      expect(app.get<Greeter>(Greeter).greet()).toBe("纯实现");
    } finally {
      await app.dispose();
    }
  });

  it("上游是 cordis `Service` 子类：要 `new`（走 `ctx.plugin`），不能当函数调用", async () => {
    /** 上游 Service：`super(ctx, name)` 自己注册。 */
    class UpstreamService extends FakeService {
      constructor(ctx: never) {
        super(ctx, "upstream-service");
      }

      hello(): string {
        return "svc";
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Svc {
      abstract hello(): string;
    }

    /** 适配行。 */
    @Injectable()
    class SvcRow extends fromCordis(Svc, UpstreamService) {
      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [SvcRow] });
    try {
      expect(app.get<Svc>(Svc).hello(), "取到的是 Service 实例").toBe("svc");
    } finally {
      await app.dispose();
    }
  });

  it("适配行的契约算作已提供：别的行 inject 契约不会被判缺依赖", async () => {
    /** 上游插件：注册 `foo`。 */
    const upstream = {
      name: "foo-upstream",
      apply: (ctx: unknown) => {
        (ctx as { provide(name: string, value: unknown): void }).provide("foo", { hi: () => "hi" });
      },
    };

    /** 契约。 */
    @Injectable()
    abstract class Foo {
      abstract hi(): string;
    }

    /** 适配行。 */
    @Injectable()
    class FooRow extends fromCordis(Foo, upstream) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    /** 消费者：只按契约注入。 */
    @Injectable()
    class Consumer {
      readonly foo = inject(Foo);
    }

    // 编译期：`Foo` 由适配行的 `token` 提供，不该出现在 `__missingProviders` 里。
    const app = await bootstrapApplication({ providers: [FooRow, Consumer] });
    try {
      expect(app.get<Consumer>(Consumer).foo.hi(), "注入到的是上游面").toBe("hi");
    } finally {
      await app.dispose();
    }
  });

  it("上游的 `static Config` 默认值会被规范化：行不给 config 也能装", async () => {
    /** 上游 Service：配置默认值在 `static Config` 里，构造里直接读。 */
    class SizedService extends FakeService {
      static Config = (input: { size?: number } = {}) => ({ size: input.size ?? 4 });

      readonly size: number;

      constructor(ctx: never, config: { size: number }) {
        super(ctx, "sized-service");
        this.size = config.size;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Sized {
      abstract size: number;
    }

    /** 适配行：不传 config。 */
    @Injectable()
    class SizedRow extends fromCordis(Sized, SizedService) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [SizedRow] });
    try {
      expect(app.get<Sized>(Sized).size, "默认值来自上游 Config").toBe(4);
    } finally {
      await app.dispose();
    }
  });

  it("上游用 `ctx.reflect.provide` 发布时也能取到契约面", async () => {
    /** 上游插件：走 `ctx.reflect.provide`（真实上游常见写法）。 */
    const upstream = {
      name: "reflect-publishing",
      apply: (ctx: unknown) => {
        const reflect = (ctx as { reflect: { provide(name: string, value: unknown): void } }).reflect;
        reflect.provide("reflect-published", { ok: true });
      },
    };

    /** 契约。 */
    @Injectable()
    abstract class Published {
      abstract ok: boolean;
    }

    /** 适配行。 */
    @Injectable()
    class PublishedRow extends fromCordis(Published, upstream) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [PublishedRow] });
    try {
      expect(app.get<Published>(Published).ok, "reflect.provide 也要记到").toBe(true);
    } finally {
      await app.dispose();
    }
  });

  it("上游用 `ctx.extend` 建子 ctx 时，子 ctx 也能读到 deps", async () => {
    /** 上游 Service：建子 ctx 并在子 ctx 上读依赖（真实上游的 `agent.ctx` 就是这样）。 */
    class ExtendingService extends FakeService {
      static inject = ["locale"];

      readonly child: unknown;

      constructor(ctx: never) {
        super(ctx, "extending-service");
        this.child = (ctx as unknown as { extend(meta: unknown): unknown }).extend({ name: "child" });
      }

      greetFromChild(): string {
        const locale = (this.child as { locale: { hello: string } }).locale;
        return locale.hello;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Extending {
      abstract greetFromChild(): string;
    }

    /** 适配行。 */
    @Injectable()
    class ExtendingRow extends fromCordis(Extending, ExtendingService) {
      private readonly locale = inject(LocaleRow);

      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.locale });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, ExtendingRow] });
    try {
      expect(app.get<Extending>(Extending).greetFromChild(), "子 ctx 读到的也是 deps").toBe("你好");
    } finally {
      await app.dispose();
    }
  });

  it("上游用 `ctx.plugin` 拿 fiber、再从 `fiber.ctx` 建 scope 时，也能读到 deps", async () => {
    /** 上游 Service：走 `ctx.plugin(...)` → `fiber.ctx.extend(...)` 两跳。 */
    class ScopingService extends FakeService {
      seen: string | undefined;

      constructor(ctx: never) {
        super(ctx, "scoping-service");
        const plugin = (ctx as unknown as {
          plugin(sub: unknown): { ctx: { extend(meta: unknown): unknown } };
        }).plugin({ name: "scope-holder", apply: () => {} });
        const scoped = plugin.ctx.extend({ name: "scope" });
        // plugin 的 apply 是异步的，读 deps 放在下一拍。
        void Promise.resolve().then(() => {
          this.seen = (scoped as { locale?: { hello?: string } }).locale?.hello;
        });
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Scoping {
      abstract seen: string | undefined;
    }

    /** 适配行。 */
    @Injectable()
    class ScopingRow extends fromCordis(Scoping, ScopingService) {
      private readonly locale = inject(LocaleRow);

      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.locale });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, ScopingRow] });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.get<Scoping>(Scoping).seen, "fiber.ctx 往下也读得到 deps（LocaleRow 的 hello）").toBe("你好");
    } finally {
      await app.dispose();
    }
  });

  it("上游把服务放在子插件里（`ctx.plugin`）：mount 等它落定后再取面", async () => {
    /** 上游插件：服务由子插件注册，apply 返回时还没构造。 */
    const upstream = {
      name: "child-provider",
      apply: (ctx: unknown) => {
        const cordis = ctx as { plugin(sub: unknown): unknown };
        cordis.plugin({
          name: "child",
          apply: (child: unknown) => {
            (child as { provide(name: string, value: unknown): void }).provide("child-service", {
              value: "from-child",
            });
          },
        });
      },
    };

    /** 契约：连字符名与上游注册名一致。 */
    @Injectable()
    abstract class ChildService {
      abstract value: string;
    }

    /** 适配行。 */
    @Injectable()
    class ChildServiceRow extends fromCordis(ChildService, upstream) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    /** 消费者：排在适配行之后。 */
    @Injectable()
    class ChildConsumer {
      readonly child = inject(ChildService);
    }

    const app = await bootstrapApplication({ providers: [ChildServiceRow, ChildConsumer] });
    try {
      expect(app.get<ChildConsumer>(ChildConsumer).child.value, "拿到的是子插件注册的服务").toBe(
        "from-child",
      );
    } finally {
      await app.dispose();
    }
  });

  it("适配行的上游服务注册到根：兄弟行按名字读得到", async () => {
    /** 上游 Service：`super(ctx, name)` 注册自己。 */
    class RootVisibleService extends FakeService {
      constructor(ctx: never) {
        super(ctx, "root-visible");
      }

      hi(): string {
        return "hi";
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class RootVisible {
      abstract hi(): string;
    }

    /** 适配行。 */
    @Injectable()
    class RootVisibleRow extends fromCordis(RootVisible, RootVisibleService) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    /** 兄弟行：不注入契约，直接按名字从行 ctx 读（上游常见的写法）。 */
    @Injectable()
    class SiblingRow {
      name: string | undefined;

      onInit(ctx: Context): void {
        const root = (ctx as unknown as { root: { get(name: string, strict?: boolean): unknown } })
          .root;
        this.name = (root.get("root-visible", false) as { hi(): string } | undefined)?.hi();
      }
    }

    const app = await bootstrapApplication({ providers: [RootVisibleRow, SiblingRow] });
    try {
      expect(app.get<SiblingRow>(SiblingRow).name, "兄弟行读得到适配行注册的服务").toBe("hi");
    } finally {
      await app.dispose();
    }
  });

  it("`ctx.inject` 短路给 deps 时，回调拿到的是派生 ctx 而不是行代理", async () => {
    let fromInject: unknown;
    /** 上游插件：`ctx.inject` 的回调里读依赖（`file-reference-local` 就是在这个回调里注册段落）。 */
    const upstream = {
      name: "inject-shortcut",
      apply: (ctx: unknown) => {
        const cordis = ctx as {
          inject(names: readonly string[], cb: (scoped: unknown) => unknown): unknown;
        };
        cordis.inject(["locale"], (scoped) => {
          fromInject = scoped;
        });
      },
    };

    /** 契约。 */
    @Injectable()
    abstract class InjectShortcut {
      abstract readonly ok: boolean;
    }

    /** 适配行：deps 里给 `locale`，命中 `inject` 的短路分支。 */
    @Injectable()
    class InjectShortcutRow extends fromCordis(InjectShortcut, upstream) {
      readonly rowCtx = inject(LocaleRow);

      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.rowCtx });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, InjectShortcutRow] });
    try {
      // 短路若把**行代理**交给回调，上游按 `scopeOf(ctx)` 分层的信息就丢了（注册会掉进 global 层，
      // 第二个 agent 就撞名）。派生 ctx 与行 ctx 不是同一个对象，且能看到 deps。
      expect(fromInject, "回调必须有 ctx").toBeDefined();
      expect(fromInject, "不能是行代理本身").not.toBe(app.ctx);
      expect((fromInject as { locale?: { hello: string } }).locale?.hello, "deps 仍可读").toBe(
        "你好",
      );
    } finally {
      await app.dispose();
    }
  });

  it("上游 `Service` 的 `[FakeService.init]` 会被等完再返回", async () => {
    /** 上游 Service：异步注册放在 `[FakeService.init]`。 */
    class LazyService extends FakeService {
      ready = false;

      constructor(ctx: never) {
        super(ctx, "lazy-service");
      }

      async [FakeService.init](): Promise<void> {
        await Promise.resolve();
        this.ready = true;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Lazy {
      abstract ready: boolean;
    }

    /** 适配行。 */
    @Injectable()
    class LazyRow extends fromCordis(Lazy, LazyService) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [LazyRow] });
    try {
      expect(app.get<Lazy>(Lazy).ready, "mount 返回时 init 已完成").toBe(true);
    } finally {
      await app.dispose();
    }
  });

  it("上游 `Service` 子类在构造里读依赖时也走 deps 替换", async () => {
    /** 上游 Service：构造里就读依赖（cordis 对 `static inject` 的名字有访问检查）。 */
    class GreetingService extends FakeService {
      static inject = ["locale"];

      readonly hello: string;

      constructor(ctx: never) {
        super(ctx, "greeting-service");
        const locale = (ctx as unknown as { locale: { hello: string } }).locale;
        this.hello = locale.hello;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Greeting {
      abstract hello: string;
    }

    /** 适配行。 */
    @Injectable()
    class GreetingRow extends fromCordis(Greeting, GreetingService) {
      private readonly locale = inject(LocaleRow);

      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx, undefined, { locale: this.locale });
      }
    }

    const app = await bootstrapApplication({ providers: [LocaleRow, GreetingRow] });
    try {
      expect(app.get<Greeting>(Greeting).hello, "构造期读到的是 deps").toBe("你好");
    } finally {
      await app.dispose();
    }
  });

  it("注入实现类时，类型上带上游成员（宿主侧行不用 `as` 断言）", async () => {
    /** 上游 Service：有契约没声明的成员 `list`。 */
    class UpstreamRegistry extends FakeService {
      constructor(ctx: never) {
        super(ctx, "upstream-registry");
      }

      list(): readonly string[] {
        return ["a"];
      }
    }

    /** 契约只声明收窄的面。 */
    @Injectable()
    abstract class Registry {
      abstract describe(): string;
    }

    /** 适配行。 */
    @Injectable()
    class RegistryRow extends fromCordis(Registry, UpstreamRegistry) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    /** 宿主侧行：注入**实现类**拿上游才有的成员。 */
    @Injectable()
    class Host {
      readonly registry = inject(RegistryRow);
    }

    const app = await bootstrapApplication({ providers: [RegistryRow, Host] });
    try {
      // 编译期：`registry.list()` 存在（运行时拿到的就是上游实例）。
      expect(app.get<Host>(Host).registry.list(), "上游成员可直接用").toEqual(["a"]);
    } finally {
      await app.dispose();
    }
  });

  it("行配置从清单给：适配行不必自己存构造参数", async () => {
    /** 上游 Service：配置由上游 schema 给默认值。 */
    class ConfigurableService extends FakeService {
      static Config = (input: { size?: number } = {}) => ({ size: input.size ?? 1 });

      readonly size: number;

      constructor(ctx: never, config: { size: number }) {
        super(ctx, "configurable-service");
        this.size = config.size;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Configurable {
      abstract size: number;
    }

    /** 适配行：没有构造函数，`mount(ctx)` 缺省用清单给的 config。 */
    @Injectable()
    class ConfigurableRow extends fromCordis(Configurable, ConfigurableService) {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({
      providers: [{ provide: ConfigurableRow, config: { size: 7 } }],
    });
    try {
      expect(app.get<Configurable>(Configurable).size, "清单条目上的 config 生效").toBe(7);
    } finally {
      await app.dispose();
    }
  });

  it("适配行的 `static defaultConfig` 与行配置深合并后再交给上游 schema", async () => {
    /** 上游 Service：schema 只补第三层默认值。 */
    class LayeredService extends FakeService {
      static Config = (input: { size?: number; tag?: string; extra?: number } = {}) => ({
        size: input.size ?? 1,
        tag: input.tag ?? "default",
        extra: input.extra ?? 0,
      });

      readonly config: { size: number; tag: string; extra: number };

      constructor(ctx: never, config: { size: number; tag: string; extra: number }) {
        super(ctx, "layered-service");
        this.config = config;
      }
    }

    /** 契约。 */
    @Injectable()
    abstract class Layered {
      abstract config: { size: number; tag: string; extra: number };
    }

    /** 适配行：声明自己的默认配置，行配置只覆盖其中一项。 */
    @Injectable()
    class LayeredRow extends fromCordis(Layered, LayeredService) {
      static readonly defaultConfig = { size: 2, tag: "row-default" };

      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({
      providers: [{ provide: LayeredRow, config: { size: 9 } }],
    });
    try {
      expect(app.get<Layered>(Layered).config, "三层：defaultConfig → 行配置 → schema 默认").toEqual({
        size: 9,
        tag: "row-default",
        extra: 0,
      });
    } finally {
      await app.dispose();
    }
  });

  it("适配行忘了 mount：装配期就报错，不把空壳留给消费方", async () => {
    /** 上游插件。 */
    const upstream = {
      name: "unmounted-upstream",
      apply: (ctx: unknown) => {
        (ctx as { provide(name: string, value: unknown): void }).provide("greeter", {
          greet: () => "hi",
        });
      },
    };

    /** 忘了 `mount` 的适配行。 */
    @Injectable()
    class ForgotRow extends fromCordis(Greeter, upstream) {
      override async onInit(): Promise<void> {}
    }

    await expect(bootstrapApplication({ providers: [ForgotRow] })).rejects.toThrow(/mount/);
  });

  it("卸载时调用上游 apply 返回的 disposer", async () => {
    const calls: string[] = [];

    /** 上游插件：返回 disposer。 */
    const upstream = {
      name: "disposable-upstream",
      apply: () => () => {
        calls.push("upstream-disposed");
      },
    };

    /** 适配行。 */
    @Injectable()
    class Row extends fromCordis(Greeter, upstream) {
      async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [Row] });
    await app.dispose();
    expect(calls).toEqual(["upstream-disposed"]);
  });
});

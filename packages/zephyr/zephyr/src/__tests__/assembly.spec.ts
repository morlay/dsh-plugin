import { describe, expect, it } from "vitest";
import { fromCordis } from "../compat/index.ts";
import type { OnDispose, OnInit } from "../index.ts";
import {
  bootstrapApplication,
  configure,
  Debugger,
  Injectable,
  inject,
  InjectionToken as InjectionTokenFromIndex,
  Logger,
  provide,
  without,
  type Context,
} from "../index.ts";

/** 契约：唯一的注入目标。 */
@Injectable()
abstract class Greeter {
  abstract greet(): string;
}

/** 实现：只出现在装配清单里。 */
@Injectable()
class GreeterDefault extends Greeter {
  greet(): string {
    return "hi";
  }
}

/** 消费者：字段注入拿到契约类型。 */
@Injectable()
class Consumer {
  readonly greeter = inject(Greeter);
}

describe("装配的最小闭环", () => {
  it("契约 + 实现 + 消费者：bootstrap 之后 inject 拿到同一个实例", async () => {
    const app = await bootstrapApplication({ providers: [GreeterDefault, Consumer] });
    try {
      const consumer = app.get(Consumer);
      expect(consumer.greeter).toBeInstanceOf(GreeterDefault);
      expect(app.get(Greeter), "按契约取到的就是注入的那个实例").toBe(consumer.greeter);
      expect(consumer.greeter.greet()).toBe("hi");
    } finally {
      await app.dispose();
    }
  });

  it("`onInit(ctx)` 拿到的是 cordis ctx：行里 provide 的服务与装配是同一个 store", async () => {
    /** 行：在 onInit 里往自己的 ctx 注册服务。 */
    @Injectable()
    class Row implements OnInit {
      onInit(ctx: Context): void {
        (ctx as unknown as { provide(name: string, value: unknown): void }).provide("own-service", {
          ok: true,
        });
      }
    }

    const app = await bootstrapApplication({ providers: [Row] });
    try {
      const read = (app.ctx as unknown as { get(name: string): unknown }).get("own-service");
      expect(read, "行 ctx 与 app.ctx 是同一棵树里的 cordis ctx").toEqual({ ok: true });
    } finally {
      await app.dispose();
    }
  });

  it("`configure` 深合并 config，`without` 剔除条目", async () => {
    /** 带 Config 的 Provider：config 由 `configure` 给，默认值由自己负责。 */
    @Injectable()
    class Configured {
      constructor(readonly options: Record<string, unknown> = {}) {}
    }

    /** 一个要被剔除的行。 */
    @Injectable()
    class Removed {}

    const list = provide([Configured, Removed])(
      configure(Configured, { retry: { times: 5 }, tags: ["b"] }),
      configure(Configured, { retry: { delay: 20 }, tags: ["c"] }),
      without(Removed),
    );
    const app = await bootstrapApplication({ providers: list });
    try {
      const configured = app.get<Configured>(Configured);
      expect(configured.options, "对象逐键合并、数组整体替换").toEqual({
        retry: { times: 5, delay: 20 },
        tags: ["c"],
      });
      expect(app.tryGet(Removed), "without 之后没有它").toBeUndefined();
    } finally {
      await app.dispose();
    }
  });

  it("上游按名字发布的服务能按同名令牌取到（没有对应的行）", async () => {
    /** 名字型令牌：与上游发布的名字一致。 */
    const SidebarTabs = InjectionTokenFromIndex<{ tabs: string[] }>("sidebar-tabs");

    /** 上游插件：只按名字发布服务。 */
    const upstream = {
      name: "sidebar-tabs-upstream",
      apply: (ctx: unknown) => {
        (ctx as { provide(name: string, value: unknown): void }).provide("sidebar-tabs", {
          tabs: ["chat"],
        });
      },
    };

    /** 无契约的适配行。 */
    const Adapted = fromCordis(upstream);

    /** 适配行。 */
    @Injectable()
    class TabsRow extends Adapted {
      override async onInit(ctx: Context): Promise<void> {
        await this.mount(ctx);
      }
    }

    const app = await bootstrapApplication({ providers: [TabsRow] });
    try {
      expect(app.get(SidebarTabs).tabs, "按名字反查到令牌").toEqual(["chat"]);
    } finally {
      await app.dispose();
    }
  });

  it("裸 cordis 插件不能直接进装配：必须经 fromCordis / toCordis 转换", async () => {
    /** 没转换的上游插件。 */
    const raw = { name: "raw-upstream", apply: () => {} };

    await expect(bootstrapApplication({ providers: [raw as never] })).rejects.toThrow(/fromCordis/);
  });

  it("`inject.optional` 缺失给 undefined，`inject.all` 按清单顺序聚合", async () => {
    /** 多值契约。 */
    @Injectable({ multi: true })
    abstract class Step {
      abstract order: number;
    }

    /** 第一个实现。 */
    @Injectable()
    class StepOne extends Step {
      order = 1;
    }

    /** 第二个实现。 */
    @Injectable()
    class StepTwo extends Step {
      order = 2;
    }

    /** 消费者：可选依赖 + 多值依赖。 */
    @Injectable()
    class Runner {
      readonly steps = inject.all(Step);

      readonly missing = inject.optional(Greeter);
    }

    const app = await bootstrapApplication({ providers: [StepTwo, StepOne, Runner] });
    try {
      const runner = app.get<Runner>(Runner);
      expect(
        runner.steps.map((step) => step.order),
        "按清单顺序",
      ).toEqual([2, 1]);
      expect(runner.missing, "没有提供者时给 undefined").toBeUndefined();
      expect(
        app.getAll(Step).map((step) => step.order),
        "`App.getAll` 与 `inject.all` 同一份",
      ).toEqual([2, 1]);
    } finally {
      await app.dispose();
    }
  });

  it("`onInit` 抛错：应用不返回，已启动的逆序卸载", async () => {
    const calls: string[] = [];

    /** 先启动的行。 */
    @Injectable()
    class Ok implements OnDispose {
      onDispose(): void {
        calls.push("ok");
      }
    }

    /** 后启动、启动即失败的行。 */
    @Injectable()
    class Boom implements OnInit, OnDispose {
      onInit(): void {
        throw new Error("boom");
      }

      onDispose(): void {
        calls.push("boom");
      }
    }

    await expect(bootstrapApplication({ providers: [Ok, Boom] })).rejects.toThrow("boom");
    expect(calls, "已启动的行要收尾").toContain("ok");
  });

  it("`dispose`：onDispose 按装配的逆序执行", async () => {
    const calls: string[] = [];

    /** 第一行。 */
    @Injectable()
    class First implements OnDispose {
      onDispose(): void {
        calls.push("first");
      }
    }

    /** 第二行。 */
    @Injectable()
    class Second implements OnDispose {
      onDispose(): void {
        calls.push("second");
      }
    }

    const app = await bootstrapApplication({ providers: [First, Second] });
    await app.dispose();
    expect(calls).toEqual(["second", "first"]);
  });

  it("形态用错：`inject` 用在 multi 令牌上、`inject.all` 用在单值令牌上，都在装配前报错", async () => {
    /** 多值契约。 */
    @Injectable({ multi: true })
    abstract class Hook {
      abstract run(): void;
    }

    /** 多值实现。 */
    @Injectable()
    class HookOne extends Hook {
      run(): void {}
    }

    /** 单值实现。 */
    @Injectable()
    class Single {
      readonly value = 1;
    }

    /** 误用一：单值注入 multi 令牌。 */
    @Injectable()
    class WrongSingle {
      readonly hook = inject(Hook);
    }

    /** 误用二：多值注入单值令牌。 */
    @Injectable()
    class WrongAll {
      readonly singles = inject.all(Single);
    }

    await expect(bootstrapApplication({ providers: [HookOne, WrongSingle] })).rejects.toThrow(
      /multi/i,
    );
    await expect(bootstrapApplication({ providers: [Single, WrongAll] })).rejects.toThrow(/multi/i);
  });

  it("`InjectionToken`：纯值配置按令牌注入", async () => {
    /** 用 `InjectionToken` 声明的配置。 */
    const Config = new InjectionTokenFromIndex<{ port: number }>("app-config");

    /** 读配置的行。 */
    @Injectable()
    class ReadsConfig {
      readonly config = inject(Config);
    }

    const app = await bootstrapApplication({
      providers: [{ provide: Config as unknown as object, useValue: { port: 4321 } }, ReadsConfig],
    });
    try {
      expect(app.get(ReadsConfig).config.port).toBe(4321);
    } finally {
      await app.dispose();
    }
  });

  it("`Logger` 契约接的是 cordis 原生 logger", async () => {
    /** 读日志的行。 */
    @Injectable()
    class Logged {
      readonly logger = inject(Logger);
    }

    const app = await bootstrapApplication({ providers: [Logged] });
    try {
      const logger = app.get<Logged>(Logged).logger;
      expect(typeof logger.info, "契约面就是 cordis logger").toBe("function");
      expect(app.get(Logger), "同一个实例").toBe(logger);
    } finally {
      await app.dispose();
    }
  });

  it("`onDispose` 执行时依赖仍可读（使用方先于提供方卸载）", async () => {
    const seen: number[] = [];

    /** 提供方。 */
    @Injectable()
    class Provider2 {
      readonly value = 42;
    }

    /** 使用方：卸载时读依赖。 */
    @Injectable()
    class Consumer2 implements OnDispose {
      readonly provider = inject(Provider2);

      onDispose(): void {
        seen.push(this.provider.value);
      }
    }

    const app = await bootstrapApplication({ providers: [Provider2, Consumer2] });
    await app.dispose();
    expect(seen).toEqual([42]);
  });

  it("`Debugger` 是普通契约：诊断给出每行结果、服务名与令牌名", async () => {
    const app = await bootstrapApplication({ providers: [GreeterDefault, Consumer] });
    try {
      const snapshot = app.get(Debugger).diagnostics();
      expect(snapshot.rows.map((row) => row.name)).toContain("greeter-default");
      expect(snapshot.rows.every((row) => row.state === "started")).toBe(true);
      expect(snapshot.names, "cordis store 里的服务名").toContain("greeter");
      expect(snapshot.tokens, "可注入的令牌名").toContain("Greeter");
    } finally {
      await app.dispose();
    }
  });

  it("缺依赖：在任何 onInit 之前就失败，报出谁需要谁", async () => {
    const started: string[] = [];

    /** 先启动的行：如果依赖检查晚于它，它就会被启动（那是错的）。 */
    @Injectable()
    class Early implements OnInit {
      onInit(): void {
        started.push("early");
      }
    }

    /** 缺依赖的消费者。 */
    @Injectable()
    class Needs implements OnInit {
      readonly missing = inject(Greeter);

      onInit(): void {
        started.push("needs");
      }
    }

    await expect(
      // @ts-expect-error 缺 `Greeter` 的提供者：编译期就该报错（`__missingProviders: Greeter`）
      bootstrapApplication({ providers: [Early, Needs] }),
    ).rejects.toThrow(/greeter/i);
    expect(started, "装配失败时不能有任何行被启动").toEqual([]);
  });

  it("`configure` 对非对象 config 整体替换（数组不会被拆成对象）", async () => {
    /** 配置是数组的 Provider（`ClientRows` 那种包名清单）。 */
    @Injectable()
    class ListConfig {
      constructor(readonly value: readonly string[] = []) {}
    }

    const list = provide([ListConfig])(configure(ListConfig, ["a", "b"] as never));
    const app = await bootstrapApplication({ providers: list });
    try {
      expect(app.get<ListConfig>(ListConfig).value, "数组原样传给构造").toEqual(["a", "b"]);
    } finally {
      await app.dispose();
    }
  });

  it("装配按 `inject` 依赖排序：清单顺序颠倒也不影响", async () => {
    const order: string[] = [];

    /** 提供者。 */
    @Injectable()
    class Provider1 {
      onInit(): void {
        order.push("provider");
      }
    }

    /** 消费者：声明注入提供者。 */
    @Injectable()
    class Consumer1 {
      readonly provider = inject(Provider1);

      onInit(): void {
        order.push("consumer");
      }
    }

    // 清单里消费者在前：顺序由 `inject` 决定，不由写法决定。
    const app = await bootstrapApplication({ providers: [Consumer1, Provider1] });
    try {
      expect(order).toEqual(["provider", "consumer"]);
    } finally {
      await app.dispose();
    }
  });

  it("每个 Provider 是一行：onInit 拿到的是子 ctx，且能读到同一棵树上的服务", async () => {
    /** 行：记下自己的 ctx，并在行内注册一个服务。 */
    @Injectable()
    class Row implements OnInit {
      seen: Context | undefined;

      onInit(ctx: Context): void {
        this.seen = ctx;
        (ctx as unknown as { provide(name: string, value: unknown): void }).provide("own", 1);
      }
    }

    const app = await bootstrapApplication({ providers: [Row] });
    try {
      const row = app.get<Row>(Row);
      expect(row.seen, "onInit 拿到的是行 ctx，不是 app.ctx").not.toBe(app.ctx);
      // 行 ctx 沿 fiber 链向上找：Provider 实例注册在根，行内读得到。
      const fromRow = (row.seen as unknown as { get(name: string): unknown }).get("row");
      expect(fromRow, "行 ctx 能读到同一棵树上注册的 Provider 实例").toBe(row);
    } finally {
      await app.dispose();
    }
  });
});

// `@Injectable({ name })` 的**别名**：装配时除了派生名（连字符）再发布一份上游服务名。
//
// 判据来自两次真事故：`SessionPersistence`（派生 `session-persistence`，上游读 `sessionPersistence`）与
// `Setting`（派生 `setting`，上游读 `settings`）。名字只发派生名时，上游那条严格读拿到 `undefined`
// 然后**静默降级**——"没配置持久化"（盘上不写东西、重启后 `session/not-found`）、
// "设置命名空间不注册"（开发工具偏好落回 false、轨迹视图被过滤）。
describe("`@Injectable({ name })` 的别名", () => {
  it("契约声明了别名，装配后按别名与派生名都读得到同一个实例", async () => {
    @Injectable({ name: "upstreamName" })
    class Aliased {
      readonly marker = "aliased";
    }

    @Injectable()
    class Plain {
      readonly marker = "plain";
    }

    const app = await bootstrapApplication({ providers: [Aliased, Plain] });
    try {
      const store = app.ctx as unknown as { get(name: string, strict?: boolean): unknown };
      // 派生名（类名连字符化）与别名都指向同一个实例。
      expect(store.get("aliased")).toBe(app.get(Aliased));
      expect(store.get("upstreamName"), "上游按这个名字严格读").toBe(app.get(Aliased));
      // 没写 `name` 的契约只有派生名，不会凭空多出发一个驼峰名（那会覆盖上游已有的同名服务）。
      expect(store.get("plain")).toBe(app.get(Plain));
      expect(store.get("plain", false)).toBe(app.get(Plain));
    } finally {
      await app.dispose();
    }
  });
});

import { describe, expect, it } from "vitest";
import { bootstrapApplication, Injectable, inject } from "@morlay/zephyr";

describe("inject() 的调用时机", () => {
  it("模块级调用：返回占位，访问依赖时才报错", () => {
    @Injectable()
    class Foo {}

    const placeholder = inject(Foo) as unknown as { value?: unknown };
    expect(() => placeholder.value).toThrow(/not ready yet/);
  });

  it("手工构造（没有 bootstrap 解析）时：字段是占位，访问即报错", () => {
    @Injectable()
    class Bar {
      dep = inject(Bar);
    }

    const bar = new Bar();
    expect(() => (bar.dep as unknown as { value?: unknown }).value).toThrow(/not ready yet/);
  });
});

describe("字段声明", () => {
  it("Symbol 键上的 inject() 同样被收集", async () => {
    const kDep = Symbol("dep");

    @Injectable()
    abstract class Log {
      abstract write(): string;
    }

    @Injectable()
    class ConsoleLog extends Log {
      write() {
        return "w";
      }
    }

    let written = "";

    @Injectable()
    class Consumer {
      [kDep] = inject(Log);

      onInit() {
        written = (this as any)[kDep].write();
      }
    }

    const app = await bootstrapApplication({ providers: [ConsoleLog, Consumer] });
    expect(written).toBe("w");
    await app.dispose();
  });

  it("未就绪的依赖被访问时立即报错，而不是静默失效", async () => {
    @Injectable()
    abstract class Missing {
      abstract y(): void;
    }

    let message = "";
    @Injectable()
    class Consumer {
      dep = inject(Missing);

      constructor() {
        try {
          (this.dep as any).y();
        } catch (error) {
          message = (error as Error).message;
        }
      }
    }

    await expect(bootstrapApplication({ providers: [Consumer], timeoutMs: 50 })).rejects.toThrow(
      /failed to activate/,
    );
    expect(message).toMatch(/is not ready yet/);
  });
});

describe("inject.optional()：可选依赖", () => {
  it("模块级调用：返回占位（可选），访问依赖时才报错", () => {
    @Injectable()
    class Foo {}

    const placeholder = inject.optional(Foo) as unknown as { value?: unknown };
    expect(() => placeholder.value).toThrow(/not ready yet/);
  });

  it("未就绪取 undefined，不等待、不阻塞启动", async () => {
    @Injectable()
    abstract class Missing {
      abstract y(): void;
    }

    @Injectable()
    class Consumer {
      dep = inject.optional(Missing);
      seen: unknown = "unset";

      onInit() {
        this.seen = this.dep;
      }
    }

    const app = await bootstrapApplication({ providers: [Consumer], timeoutMs: 50 });
    expect(app.get(Consumer).dep).toBeUndefined();
    expect(app.get(Consumer).seen).toBeUndefined();
    await app.dispose();
  });

  it("已就绪时取到实例（提供方先激活）", async () => {
    @Injectable()
    abstract class Store {
      abstract read(): string;
    }

    @Injectable()
    class StoreImpl extends Store {
      read() {
        return "value";
      }
    }

    @Injectable()
    class Consumer {
      store = inject.optional(Store);
      seen = "";

      onInit() {
        this.seen = this.store?.read() ?? "";
      }
    }

    const app = await bootstrapApplication({ providers: [StoreImpl, Consumer] });
    expect(app.get(Consumer).seen).toBe("value");
    await app.dispose();
  });
});

describe("inject.optional()：只看装配里有没有，不看先后", () => {
  it("提供方注册在后面：等到它、拿到实例，而不是 undefined", async () => {
    @Injectable()
    abstract class Router {
      abstract routes(): readonly string[];
    }

    @Injectable()
    class RouteTable extends Router {
      routes(): readonly string[] {
        return ["/sessions"];
      }
    }

    @Injectable()
    class Carrier {
      // 装配里 RouteTable 排在它后面（这次的现场：carrier 由别的模块装，位置在业务模块之后）
      router = inject.optional(Router);
      attached: readonly string[] = [];

      onInit() {
        this.attached = this.router?.routes() ?? [];
      }
    }

    const app = await bootstrapApplication({ providers: [Carrier, RouteTable] });
    expect(app.get(Carrier).router).toBeInstanceOf(RouteTable);
    expect(app.get(Carrier).attached).toEqual(["/sessions"]);
    await app.dispose();
  });

  it("同一份装配里：有提供者的等它，真没有的给 undefined（两种语义并排）", async () => {
    @Injectable()
    abstract class Router {
      abstract routes(): readonly string[];
    }

    @Injectable()
    class RouteTable extends Router {
      routes(): readonly string[] {
        return ["/sessions"];
      }
    }

    @Injectable()
    abstract class NeverPlanned {
      abstract y(): void;
    }

    @Injectable()
    class Carrier {
      router = inject.optional(Router);
      absent = inject.optional(NeverPlanned);
    }

    const app = await bootstrapApplication({ providers: [Carrier, RouteTable], timeoutMs: 500 });
    expect(app.get(Carrier).router).toBeInstanceOf(RouteTable);
    expect(app.get(Carrier).absent).toBeUndefined();
    await app.dispose();
  });
});

describe("@Injectable 装饰器", () => {
  it("保持类原型与构造行为不变", () => {
    @Injectable()
    class MyService {
      greet() {
        return "hello";
      }
    }

    expect(new MyService().greet()).toBe("hello");
  });

  it("显式 name 不影响类的形状", () => {
    @Injectable()
    class Custom {}

    expect(new Custom()).toBeInstanceOf(Custom);
  });
});

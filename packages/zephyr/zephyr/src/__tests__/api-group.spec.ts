import { describe, expect, it } from "vitest";
import { APIGroup, Injectable, bootstrapApplication, input, output } from "@morlay/zephyr";

describe("APIGroup", () => {
  it("按 group/version 描述事件域：值相等，不共享实例（模块不持有状态）", () => {
    expect(APIGroup.create("zephyr", "v1")).toEqual(APIGroup.create("zephyr", "v1"));
    expect(APIGroup.create("zephyr", "v1")).not.toEqual(APIGroup.create("zephyr", "v2"));
  });

  it("withKind 拼出事件 type", () => {
    expect(APIGroup.create("zephyr", "v1").withKind("user-created")).toBe("user-created.zephyr/v1");
    expect(APIGroup.create("dsh", "v1").withKind("session-created")).toBe("session-created.dsh/v1");
  });
});

describe("EventEmitter 的角色声明", () => {
  it("group + kind 组成 type 字符串", () => {
    const group = APIGroup.create("test", "v1");
    expect(input<[number]>(group, "values").type).toBe("values.test/v1");
    expect(output<[number]>(group, "values").type).toBe("values.test/v1");
  });

  it("消费端视图不暴露派发方法（类型层面）", () => {
    const consumer = input<[number]>("demo/only-input");

    // @ts-expect-error 故意构造：消费端视图不暴露派发方法
    expect(() => consumer.emit(1)).toThrow(/is not bound/);
    expect(consumer.type).toBe("demo/only-input");
  });

  it("产生端视图不暴露订阅方法（类型层面）", () => {
    const producer = output<[number]>("demo/only-output");

    // @ts-expect-error 故意构造：产生端视图不暴露订阅方法
    expect(() => producer.on(() => undefined)).toThrow(/is not bound/);
    expect(producer.type).toBe("demo/only-output");
  });
});

describe("EventEmitter 的桥接", () => {
  it("同 type 的 input / output 互相桥接", async () => {
    const received: number[] = [];
    const group = APIGroup.create("demo", "v1");

    @Injectable()
    class Consumer {
      out = input<[number]>(group, "out");

      onInit() {
        this.out.on((n: number) => received.push(n));
      }
    }

    @Injectable()
    class Producer {
      out = output<[number]>(group, "out");
    }

    const app = await bootstrapApplication({ providers: [Consumer, Producer] });
    app.get(Producer).out.emit(42);
    expect(received).toEqual([42]);
    await app.dispose();
  });

  it("自由字符串 type 桥接上游事件", async () => {
    const seen: string[] = [];

    @Injectable()
    class Watchdog {
      status = input<[{ status: string }]>("agent/status");

      onInit() {
        this.status.on((p) => seen.push(p.status));
      }
    }

    @Injectable()
    class Emitter {
      status = output<[{ status: string }]>("agent/status");
    }

    const app = await bootstrapApplication({ providers: [Watchdog, Emitter] });
    app.get(Emitter).status.emit({ status: "idle" });
    expect(seen).toEqual(["idle"]);
    expect(app.get(Watchdog).status.type).toBe("agent/status");
    await app.dispose();
  });
});

describe("EventEmitter 的派发模式", () => {
  it("对齐 cordis 五种派发模式", async () => {
    @Injectable()
    class Bus {
      valuesIn = input<[number]>(APIGroup.create("bus", "v1"), "values");
      values = output<[number]>(APIGroup.create("bus", "v1"), "values");
      doneIn = input<[]>(APIGroup.create("bus", "v1"), "done");
      done = output<[]>(APIGroup.create("bus", "v1"), "done");
      flowIn = input<[string]>(APIGroup.create("bus", "v1"), "flow");
      flow = output<[string]>(APIGroup.create("bus", "v1"), "flow");
      count = 0;

      onInit() {
        this.valuesIn.on((n) => (n > 10 ? "big" : undefined));
        this.valuesIn.on(() => "small");

        this.doneIn.on(() => {
          this.count += 1;
        });
        this.doneIn.on(() => {
          this.count += 1;
        });

        this.flowIn.on((_v, next) => next() + "!");
        this.flowIn.on((_v, next) => next() + "?");
      }
    }

    const app = await bootstrapApplication({ providers: [Bus] });
    const bus = app.get(Bus);

    expect(bus.values.emit(5)).toBeUndefined();

    expect(bus.values.bail(12)).toBe("big");
    expect(bus.values.bail(3)).toBe("small");

    await expect(bus.values.serial(12)).resolves.toBe("big");

    await bus.done.parallel();
    expect(bus.count).toBe(2);

    expect(bus.flow.waterfall("hello", (v) => v)).toBe("hello?!");

    await app.dispose();
  });

  it("once() 只触发一次，卸载时移除监听器", async () => {
    @Injectable()
    class OneShot {
      singleIn = input<[string]>(APIGroup.create("once", "v1"), "single");
      single = output<[string]>(APIGroup.create("once", "v1"), "single");
      seen: string[] = [];

      onInit() {
        this.singleIn.once((v) => this.seen.push(v));
      }
    }

    const app = await bootstrapApplication({ providers: [OneShot] });
    const oneShot = app.get(OneShot);

    oneShot.single.emit("a");
    oneShot.single.emit("b");
    expect(oneShot.seen).toEqual(["a"]);

    await app.dispose();
    oneShot.single.emit("c");
    expect(oneShot.seen).toEqual(["a"]);
  });
});

describe("EventEmitter 的绑定契约", () => {
  it("未绑定时（onInit 之前）使用即抛错", () => {
    class Holder {
      value = output<[number]>(APIGroup.create("audit", "v1"), "value");
    }

    const holder = new Holder();
    expect(() => holder.value.emit(1)).toThrow(/is not bound/);
  });
});

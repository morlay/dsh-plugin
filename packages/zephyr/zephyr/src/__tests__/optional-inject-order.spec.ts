// `inject.optional()` 也必须参与拓扑排序。
//
// 症状（真机）：`SessionScope` 用 `inject.optional(Skill)` 读技能目录，而它在清单里排在
// 技能注册表**之前**——optional 不进依赖边，于是它拿到的是适配行的**空壳**（上游面在
// `mount` 之后才绑上），运行期 `skill.list is not a function`。
//
// `optional` 的语义是"可能没有提供者"，不是"可以不按依赖序"：有提供者就得排在它后面。
import { describe, expect, it } from "vitest";
import { bootstrapApplication, inject, Injectable, type App, type Context } from "@morlay/zephyr";
import { fromCordis } from "../compat/index.ts";

/** 契约：上游服务的类型面。 */
@Injectable()
abstract class Registry {
  abstract list(): readonly string[];
}

/**
 * cordis `Service` 的**测试替身**：`isServiceClass` 用鸭子类型判断（静态 `init` 符号），
 * 替身不必真继承 cordis 的 `Service`（那会把 vendor 的类型依赖带进 spec）。
 */
class FakeService {
  static readonly init: unique symbol = Symbol("service.init");

  constructor(ctx: never, name: string) {
    (
      ctx as unknown as { reflect: { provide(name: string, value: unknown): void } }
    ).reflect.provide(name, this);
  }

  list(): readonly string[] {
    return ["a"];
  }
}

/** 适配行：上游 `Service` 子类发布 `registry`，契约面在 mount 之后才绑上。 */
@Injectable()
class RegistryRow extends fromCordis(Registry, FakeService) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

/** 消费者：**可选**注入契约，在自己的 `onInit` 里读它。 */
@Injectable()
class Consumer {
  readonly registry = inject.optional(Registry);

  captured: unknown = "onInit-not-run";

  onInit(): void {
    this.captured = typeof this.registry?.list;
  }
}

describe("可选注入的依赖序", () => {
  it("消费者排在适配行之前时，它的可选注入也拿到上游面（不是空壳）", async () => {
    // 顺序故意反着写：消费者在前、提供者在后。
    const app: App = await bootstrapApplication({
      providers: [Consumer, RegistryRow],
      timeoutMs: 20_000,
    });
    try {
      // 拿到适配行空壳时这里是 `undefined`；正确排到适配行之后才是 `function`。
      expect(app.get(Consumer).captured).toBe("function");
    } finally {
      await app.dispose();
    }
  });
});

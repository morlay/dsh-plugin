// 提示面的读取面：它是 `apply` 在**运行期**挂到根 ctx 上的，测的是消费方怎么拿到那一份。
//
// 结论（两种写法都钉住）：
//
// - **注入拿不到**：`inject(SchemaFormHints)` 在装配期就要有清单条目提供它，而本包不是装配行、没有
//   `provide([...])` 清单——装配期直接失败并点名，不会变成运行期的静默空态；
// - **按名读拿得到**：`schemaFormHintsOf(ctx)` 从根 store 读，不依赖装配顺序。

import {
  bootstrapApplication,
  inject,
  Injectable,
  type Context,
  type OnInit,
} from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { SchemaFormHints, SERVICE_NAME, schemaFormHintsOf } from "../schema-form/hints.ts";

// 只在运行期挂服务的行（模拟内联本包的 client 行）。
@Injectable()
class RuntimeProvider implements OnInit {
  onInit(ctx: Context): void {
    ctx.root.reflect.provide(SERVICE_NAME, { keysFor: () => ["mounted"] });
  }
}

// 消费方其一：字段注入（本包之外的业务插件会这么写）。
@Injectable()
class Injected implements OnInit {
  readonly hints = inject(SchemaFormHints);

  onInit(): void {}
}

// 消费方其二：按字面名读。
@Injectable()
class Read implements OnInit {
  keys: readonly string[] = [];

  onInit(ctx: Context): void {
    this.keys = schemaFormHintsOf(ctx)?.keysFor("row", []) ?? [];
  }
}

describe("提示面的读取面", () => {
  it("按字面名读得到运行期挂的那一份", async () => {
    const app = await bootstrapApplication({ providers: [RuntimeProvider, Read] });
    try {
      expect(app.get(Read).keys).toEqual(["mounted"]);
    } finally {
      await app.dispose();
    }
  });

  it("没人挂时读到 undefined（不抛）", async () => {
    const app = await bootstrapApplication({ providers: [Read] });
    try {
      expect(app.get(Read).keys).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  // 注入不是本包的路：装配清单里没有它的条目时，覆盖检查在**编译期**就拒绝（`__missingProviders`），
  // 运行期也不再有「拿到 undefined 后静默空态」这种可能。
  it("注入方式在编译期被覆盖检查拒绝", () => {
    // @ts-expect-error 装配清单里没有 SchemaFormHints 的条目：覆盖检查要求有提供者
    const attempt = () => bootstrapApplication({ providers: [Injected], timeoutMs: 1000 });
    expect(typeof attempt).toBe("function");
  });
});

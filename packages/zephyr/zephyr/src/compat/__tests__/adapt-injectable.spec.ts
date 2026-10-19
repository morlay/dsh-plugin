/**
 * 适配行的 `@Injectable()` 语义：**令牌继承契约、实例不发布**。
 *
 * 这两条是隔离的前提——适配子类（`XxxDefault extends fromCordis(契约, 上游)`）如果把自己当服务发布，
 * 消费方 `inject(契约)` 拿到的就是适配实例（带 `providerContext`/`inject` 字段）而不是契约面。
 */
import { Context, Service } from "@deepseek-ai/cordis";
import { bootstrapApplication, Injectable, inject } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { describe, expect, it } from "vitest";

describe("适配行的 @Injectable 语义", () => {
  it("令牌继承契约；适配子类不发布自身实例", async () => {
    class UpstreamService extends Service {
      constructor(ctx: Context) {
        super(ctx, "upstream-face");
      }
    }

    @Injectable()
    abstract class Face {
      abstract readonly label: string;
    }

    @Injectable()
    class FaceDefault extends fromCordis(Face, UpstreamService) {}

    @Injectable()
    class Consumer {
      face = inject(Face);
    }

    const app = await bootstrapApplication({ providers: [Consumer, FaceDefault] });
    try {
      const face = app.get(Face) as unknown as Record<string, unknown>;
      // 拿到的必须是**上游面**（`upstream-face` 的名字），不是适配实例。
      expect(face["constructor"]).not.toBe(FaceDefault);
      expect(Object.keys(face)).not.toContain("providerContext");
      expect(Object.keys(face)).not.toContain("providerInstance");
      expect((app.get(Consumer) as Consumer).face).toBeDefined();
    } finally {
      await app.dispose();
    }
  });
});

describe("适配行（对象插件上游）的 @Injectable 语义", () => {
  it("对象插件 provide 的面：消费方拿到的不是适配实例", async () => {
    const handle = { label: "from-object-plugin" };
    const upstream = {
      name: "object-upstream",
      apply: (ctx: unknown): void => {
        (ctx as { provide(name: string, value: unknown): void }).provide("face2", handle);
      },
    };

    @Injectable()
    abstract class Face2 {
      abstract readonly label: string;
    }

    @Injectable()
    class Face2Default extends fromCordis(Face2, upstream) {}

    @Injectable()
    class Consumer2 {
      face = inject(Face2);
    }

    const app = await bootstrapApplication({ providers: [Consumer2, Face2Default] });
    try {
      const face = app.get(Face2) as unknown as Record<string, unknown>;
      expect(face["constructor"]).not.toBe(Face2Default);
      expect(Object.keys(face)).not.toContain("providerContext");
      expect(face["label"]).toBe("from-object-plugin");
      expect((app.get(Consumer2) as Consumer2).face).toBeDefined();
    } finally {
      await app.dispose();
    }
  });
});

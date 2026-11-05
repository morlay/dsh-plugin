import { describe, expect, it } from "vitest";
import { bootstrapApplication, configure, Injectable, provide } from "../../index.ts";
import { toCordis } from "../index.ts";

describe("toCordis", () => {
  it("Provider 转成 cordis 插件对象：Config 默认值生效、onInit 被调用", async () => {
    /** 带 Config 的行。 */
    @Injectable()
    class Configured {
      static Config = (input: { port?: number } = {}) => ({ port: input.port ?? 80 });

      readonly started: boolean[] = [];

      constructor(readonly config: { port: number }) {}

      onInit(): void {
        this.started.push(true);
      }
    }

    const plugin = toCordis(Configured, { Config: Configured.Config });
    expect(plugin.name, "行名 = Provider 类名连字符化").toBe("configured");

    const app = await bootstrapApplication({ providers: [plugin as never] });
    try {
      const row = app.get<Configured>(Configured);
      expect(row.config.port).toBe(80);
      expect(row.started).toEqual([true]);
    } finally {
      await app.dispose();
    }
  });

  it("`configure` / `without` 也认插件条目", async () => {
    /** 带 Config 的行。 */
    @Injectable()
    class Plugged {
      static Config = (input: { size?: number } = {}) => ({ size: input.size ?? 1 });

      constructor(readonly config: { size: number }) {}
    }

    const list = provide([toCordis(Plugged, { Config: Plugged.Config })])(
      configure(Plugged, { size: 9 }),
    );
    const app = await bootstrapApplication({ providers: list });
    try {
      expect(app.get(Plugged).config.size).toBe(9);
    } finally {
      await app.dispose();
    }
  });

  it("卸载时跑 Provider 的 `onDispose`", async () => {
    const calls: string[] = [];

    /** 有卸载行为的行。 */
    @Injectable()
    class Disposable {
      onDispose(): void {
        calls.push("disposed");
      }
    }

    const app = await bootstrapApplication({ providers: [toCordis(Disposable) as never] });
    await app.dispose();
    expect(calls).toEqual(["disposed"]);
  });
});

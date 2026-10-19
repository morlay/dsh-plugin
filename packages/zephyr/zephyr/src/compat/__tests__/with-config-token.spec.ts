/**
 * 绑了配置的适配行：令牌必须仍是**契约**，消费方 `inject(契约)` 要能解析到。
 *
 * 背景：`configure` 会生成子类并重新打 `@Injectable()`，如果令牌漂移到子类，
 * 消费方就解析不到（表现为 `ctx.<name>` 为 undefined）。
 */
import { Context } from "@deepseek-ai/cordis";
import { bootstrapApplication, configure, Injectable, inject } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { describe, expect, it } from "vitest";

describe("绑了配置的适配行令牌", () => {
  it("configure 的子类仍以契约令牌发布", async () => {
    // 上游是 cordis Service 类（与 dsh-system-prompt 同形态）。
    const { Service } = await import("@deepseek-ai/cordis");
    class UpstreamService extends Service {
      constructor(ctx: Context, config: unknown) {
        super(ctx, "prompt-upstream");
        void config;
      }
    }

    @Injectable()
    abstract class PromptContract {
      abstract readonly label: string;
    }

    @Injectable()
    class PromptDefault extends fromCordis(PromptContract, UpstreamService) {
      readonly label = "prompt";
    }

    @Injectable()
    class Consumer {
      prompt = inject(PromptContract);
    }

    // 配置走 `configure`（Provider 上没有 withConfig 方法）。
    const configured = configure(PromptDefault, { personaPrefix: "" })([PromptDefault]);

    const app = await bootstrapApplication({ providers: [configured as never, Consumer] });
    try {
      expect(app.get(PromptContract)).toBeDefined();
      expect((app.get(Consumer) as Consumer).prompt).toBeDefined();
    } finally {
      await app.dispose();
    }
  });
});

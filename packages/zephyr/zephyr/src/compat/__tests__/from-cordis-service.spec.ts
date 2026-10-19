import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { bootstrapApplication, configuredProvider, Injectable, inject, Logger } from "@morlay/zephyr";
import { toCordis } from "@morlay/zephyr/compat";
import { fromCordisService } from "../adapters.ts";

describe("上游服务适配令牌", () => {
  it("inject(适配令牌) 拿上游 ctx 服务；toCordis 不再输出字符串 inject 数组", async () => {
    class UpstreamWeb {
      registered: string[] = [];

      register(name: string): void {
        this.registered.push(name);
      }
    }

    const Web = fromCordisService(UpstreamWeb);

    @Injectable()
    class WebSearch {
      web = inject(Web);

      onInit(): void {
        this.web.register("ollama");
      }
    }

    const ctx = new Context();
    const upstream = new UpstreamWeb();
    ctx.provide("web", upstream);

    const row = toCordis(WebSearch);
    expect("inject" in row).toBe(false);

    const dispose = await row.apply(ctx, undefined);
    expect(upstream.registered).toEqual(["ollama"]);
    await dispose();
  });

  it("上游服务晚到时先等再回填，与行装载顺序无关", async () => {
    class UpstreamWeb {
      registered: string[] = [];

      register(name: string): void {
        this.registered.push(name);
      }
    }

    const Web = fromCordisService(UpstreamWeb);

    @Injectable()
    class WebSearch {
      web = inject(Web);

      onInit(): void {
        this.web.register("ollama");
      }
    }

    const ctx = new Context();
    const row = toCordis(WebSearch);
    const pending = row.apply(ctx, undefined);

    // 让 attachProvider 先挂起在等待上游服务名。
    await Promise.resolve();
    const upstream = new UpstreamWeb();
    ctx.provide("web", upstream);

    const dispose = await pending;
    expect(upstream.registered).toEqual(["ollama"]);
    await dispose();
  });
});

describe("providerContext：上游类按名字访问服务", () => {
  it("名字视图 + 原生 ctx 都能取到上游服务，不要求行 fiber 手写 inject", () => {
    class UpstreamService {
      value = "upstream";
    }

    const ctx = new Context();
    const upstream = new UpstreamService();
    ctx.provide("upstream", upstream);

    const providerCtx = ctx;
    expect((providerCtx as unknown as Record<string, unknown>)["upstream"]).toBe(upstream);
    expect(providerCtx.get("upstream")).toBe(upstream);
  });
});

describe("configuredProvider：class 入口", () => {
  it("withConfig 返回绑定配置的 class；容器 new 出实例，inject 仍按基类令牌解析", async () => {
    @Injectable()
    class Demo {
      constructor(readonly config: { value: number }) {}
    }

    const Configured = configuredProvider(Demo, { value: 1 });
    expect(typeof Configured).toBe("function");
    expect(Configured.providerConfig).toEqual({ value: 1 });

    const app = await bootstrapApplication({ providers: [Configured] });
    expect(app.get(Demo).config).toEqual({ value: 1 });
    await app.dispose();
  });
});

describe("可注入能力", () => {
  it("logger 是可注入令牌，不读 ctx.logger", async () => {
    @Injectable()
    class Consumer {
      logger = inject(Logger);
    }

    const app = await bootstrapApplication({ providers: [Consumer] });
    expect(typeof app.get(Consumer).logger.warn).toBe("function");
    await app.dispose();
  });
});

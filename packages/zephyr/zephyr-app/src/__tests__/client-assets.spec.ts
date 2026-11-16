// `ClientAssets` 是 `ServeDefault` 的**必需前置**：页面兜底必须有一条「前端资产怎么出」的实现。
//
// 这条钉的是接缝的方向——`ServeDefault` 不再自己伸手去拿 vite（那会让运行时依赖构建器），
// 而是认这条空契约；装配里漏装实现时必须是**装配期**失败并报出「谁需要谁」，
// 不能等到第一个页面请求才 500（那时报错点会漂到 http 层，读代码的人查不到根因）。
//
// 同时钉住反向：`provideClientModules()` 自带 dev 实现，装了它就不缺——否则「必需前置」会变成
// 「应用必须自己写一行」，而那一行在迁移到 `zephyr-dev` 之后又得删掉。
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { AppEnvDefault } from "../app-env/app-env.service.ts";
import { provideAppEnv } from "../app-env/provide.ts";
import { ClientAssets } from "../client-assets/client-assets.contract.ts";
import { ViteClientAssets } from "../client-assets/vite-client-assets.service.ts";
import { FederationDefault } from "../federation/federation.service.ts";
import { ServeDefault } from "../http/serve.service.ts";
import { WebRuntimeService } from "../web/web-runtime.service.ts";
import { WebServerDefault } from "../web/web-server.service.ts";
import { WebStartupDefault } from "../web/web-startup.service.ts";
import { ViteHandoffDefault } from "../vite-handoff/vite-handoff.service.ts";
import { provideClientModules } from "../client-modules/provide.ts";

describe("ClientAssets 是 ServeDefault 的必需前置", () => {
  it("装配里没有实现：装配阶段就失败，报出 ServeDefault 需要 ClientAssets", async () => {
    // 装配**运行期**的判据：`ServeDefault` 的注入字段是 `private`，编译期的覆盖检查
    // （`ProvidersCoverage`）只看公开字段，抓不到这条——所以这里钉运行期那句「谁需要谁」。
    await expect(
      bootstrapApplication({
        // **字面量清单、连 vite 那行都装上**：「实现行在」不等于「契约被满足」——这正是这条接缝要钉的地方。
        providers: [
          ...provideAppEnv(
            configure(AppEnvDefault, {
              profileDir: process.cwd(),
              dataDir: join(tmpdir(), "dsh-client-assets-test"),
            }),
          ),
          WebStartupDefault,
          WebServerDefault,
          WebRuntimeService,
          ViteHandoffDefault,
          FederationDefault,
          ServeDefault,
        ],
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/client-assets.*ServeDefault|ServeDefault.*client-assets/u);
  });

  it("`provideClientModules()` 自带 dev 实现：同批装起来不缺", async () => {
    // 只验**清单层面**的覆盖：真起服务要 vite（另有用例守着），这里读的是装配函数给出的条目。
    const entries = provideClientModules();
    const classes: unknown[] = entries.map((entry) =>
      typeof entry === "function" ? entry : (entry as { provide: unknown }).provide,
    );
    expect(classes, "dev 实现必须在装配根里").toContain(ViteClientAssets);
    expect(classes, "页面兜底也在同一份清单里").toContain(ServeDefault);
    expect(
      classes.indexOf(ViteClientAssets) < classes.indexOf(ServeDefault),
      "实现要排在消费者之前（同批装配时按依赖序）",
    ).toBe(true);
  });

  it("契约面：`ViteClientAssets` 是 `ClientAssets` 的实现（令牌是契约，不另立身份）", () => {
    expect(ViteClientAssets.prototype).toBeInstanceOf(ClientAssets);
    for (const member of ["serve", "transformHtml", "onServerSourceChange"] as const) {
      expect(typeof ViteClientAssets.prototype[member], member).toBe("function");
    }
    expect(
      Object.getOwnPropertyDescriptor(ViteClientAssets.prototype, "hmr"),
      "`hmr` 是只读成员（原型上的 getter）",
    ).toMatchObject({ get: expect.any(Function) as unknown, set: undefined });
  });
});

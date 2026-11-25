/**
 * auth 域的真装配：真 `LocalCredentialProvider`（落临时目录的 `.credentials.yaml`）+
 * 真 `AuthorizationService`，只有 `AppEnv` 是假件（它是外部运行环境，不是本包服务）。
 *
 * 两条用例守住该包转发的两层能力：凭证引用按分层来源解析，与授权流的登记/撤销。
 */
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { AppEnv } from "@morlay/zephyr-app";
import { vi } from "vitest";
import { Credentials, RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { Authorization, credentialRef } from "../index.ts";
import { provideAuth } from "../server/index.ts";
// `Authorization` 没有模块覆盖（本应用的授权消费方还没装）：装配面只能显式列这一行。
import { AuthorizationDefault } from "../authorization.service.ts";

/** 指向临时目录的运行环境（凭证文件就在 `dataDir` 下）。 */
/** 起真 auth 栈。 */
async function boot(
  appEnv: AppEnvFixture,
): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: appEnv },
      ...provideAuth(),
      AuthorizationDefault,
      RemoteHandlersDefault,
    ],
    timeoutMs: 10_000,
  });
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return { app };
}

describe("auth 域", () => {
  test("装配后两个契约令牌都可解析；凭证按来源分层解析", async ({ appEnv }) => {
    const { app } = await boot(appEnv);

    const credentials = app.get(Credentials);
    expect(typeof credentials.resolve).toBe("function");
    expect(typeof app.get(Authorization).registerFlow).toBe("function");

    const missing = credentialRef("DSH_TEST_ABSENT_KEY");
    expect(await credentials.resolve(missing)).toBeUndefined();

    // 未提供 `launchEnvironment` 快照时，provider 回落到继承的进程环境。
    vi.stubEnv("DSH_TEST_PRESENT_KEY", "sk-env");
    try {
      expect(await credentials.resolve(credentialRef("DSH_TEST_PRESENT_KEY"))).toEqual({
        value: "sk-env",
        source: "env",
      });
    } finally {
      delete process.env.DSH_TEST_PRESENT_KEY;
    }
  });

  test("授权流登记后能从 Authorization 列举出来，撤销后消失", async ({ appEnv }) => {
    const { app } = await boot(appEnv);

    const authorization = app.get(Authorization);
    const key = credentialKey("dsh-test", "flow");
    const dispose = authorization.registerFlow({
      key,
      label: "测试流",
      methods: [{ id: "manual", label: "手动" }],
      run: async () => {},
    });

    expect(authorization.list().map((entry) => entry.key)).toEqual([key]);
    dispose();
    expect(authorization.list()).toEqual([]);
  });
});

describe("credentials 组的宿主端点", () => {
  // 引用名用**测试专用的假名字**：`DEEPSEEK_API_KEY` 这类真实名字会被开发机/CI 的环境变量填成
  // `configured: true`，断言就随环境漂移。
  test(
    "`describe` 返回每个引用的视图，`set`/`unset` 往返改变 `configured`",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { app } = await boot(appEnv);
      const handlers = app.get(RemoteHandlers);

      const before = await handlers.invoke("credentials/describe", { refs: ["DSH_SPEC_FAKE_KEY"] });
      expect(before).toMatchObject({
        ok: true,
        value: { DSH_SPEC_FAKE_KEY: { configured: false, writable: expect.any(Boolean) } },
      });

      expect(
        await handlers.invoke("credentials/set", { ref: "DSH_SPEC_FAKE_KEY", value: "sk-spec" }),
      ).toMatchObject({
        ok: true,
      });
      expect(
        await handlers.invoke("credentials/describe", { refs: ["DSH_SPEC_FAKE_KEY"] }),
      ).toMatchObject({
        ok: true,
        value: { DSH_SPEC_FAKE_KEY: { configured: true } },
      });

      expect(
        await handlers.invoke("credentials/unset", { ref: "DSH_SPEC_FAKE_KEY" }),
      ).toMatchObject({ ok: true });
      expect(
        await handlers.invoke("credentials/describe", { refs: ["DSH_SPEC_FAKE_KEY"] }),
      ).toMatchObject({
        ok: true,
        value: { DSH_SPEC_FAKE_KEY: { configured: false } },
      });
    },
  );

  test(
    "非法引用名走失败面：`{ ok:false, error:{ code, message } }`（不缺字段）",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const { app } = await boot(appEnv);
      const result = await app
        .get(RemoteHandlers)
        .invoke("credentials/describe", { refs: ["not a ref!"] });
      expect(result).toMatchObject({
        ok: false,
        error: { code: expect.any(String), message: expect.stringContaining("引用名") },
      });
    },
  );
});

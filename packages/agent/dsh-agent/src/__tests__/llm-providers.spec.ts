// LLM provider 的**配置行**装上去之后，设置页的读面（`settings/describe`）看得到什么。
//
// 判据只有一条：装配层 `configure(实现类, …)` 给的 provider（这里的 ollama）必须出现在
// `llm-pi-ai` 视图的 `base` 与 `value` 里——模型页按 `value` 的 `settingsPath` 判「配没配」，
// 缺了这一层，装配里配好的第三方 provider 在设置里永远是「未配置」。
//
// 不起浏览器、不走 wire：`settings/describe` 的 handler 打进真装配（`SettingSchema` + provider 行）。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { expect, test } from "@morlay/zephyr-app/testing";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideSetting } from "@morlay/dsh-setting/server";
import { LaunchEnvironment } from "../contract/launch-environment.contract.ts";
import { LlmDefault } from "../llm.service.ts";
import { LlmPiAi } from "../llm-pi-ai.service.ts";
import { provideLlmProviders } from "../llm-providers.provide.ts";

/** `settings/describe` 的一个命名空间视图（只取用例读的字段）。 */
interface DescribeView {
  readonly ns: string;
  readonly value?: Record<string, unknown>;
  readonly base?: Record<string, unknown>;
  readonly user?: unknown;
  readonly secrets?: readonly unknown[];
}

test(
  "装配层配的 ollama route 出现在 `llm-pi-ai` 的 base 与生效值里",
  { timeout: 20_000 },
  async ({ appEnv }) => {
    const app = await bootstrapApplication({
      providers: [
        // 配置文档落在 `<dataDir>/settings.json`：数据根就是本用例的临时目录。
        { provide: AppEnv, useValue: appEnv },
        // 启动环境快照：provider 头里的 `${OLLAMA_API_KEY}` 引用按它解析。
        {
          provide: LaunchEnvironment,
          useFactory: () => ({
            snapshot: {
              get: (name: string) =>
                name === "OLLAMA_API_KEY" ? { value: "sk-deployment-secret" } : undefined,
            },
          }),
        },
        ...provideSetting(),
        // DeepSeek 的两条路由（api-key / account）都从 `ctx.deepseekAuth` 取凭据（上游 0.2.3）：
        // 这是它们的显式依赖，装配里要有这一行。
        ...provideAuth(),
        // agent 核心在配置域之前：provider 行要 `Llm` 的面。
        LlmDefault,
        ...provideLlmProviders(
          configure(LlmPiAi, {
            providers: {
              ollama: {
                apiKeyEnv: "OLLAMA_API_KEY",
                displayName: "Ollama Cloud",
                api: "anthropic-messages",
                baseURL: "https://ollama.com",
                headers: { Authorization: "Bearer ${OLLAMA_API_KEY}" },
              },
            },
          }),
        ),
        RemoteHandlersDefault,
      ],
      timeoutMs: 20_000,
    });
    // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
    appEnv.onCleanup(() => app.dispose().catch(() => {}));

    // 裸值口径：端点直接回视图（`RemoteResult` 由桥/客户端面包）。双包时这里会是 `{ ok, value }`，
    // 于是下面 `result?.ok` 是 `undefined`、`namespaces` 也读不到。
    const described = (await app.get(RemoteHandlers).invoke("settings/describe", {})) as {
      namespaces: readonly DescribeView[];
    };
    expect(described).not.toHaveProperty("ok");
    const view = described.namespaces.find((entry) => entry.ns === "llm-pi-ai");
    if (view === undefined) throw new Error("settings/describe 里没有 llm-pi-ai 的视图");

    const ollama = { baseURL: "https://ollama.com", displayName: "Ollama Cloud" };
    // 生效值（schema 默认 ⊕ 装配层 ⊕ 用户层）：模型页按它判「这个 provider 配没配」。
    expect(view.value?.providers).toMatchObject({ ollama });
    // `base` 只放装配层：用户层没写过，所以 `user` 缺省。
    expect(view.base).toMatchObject({ providers: { ollama } });
    expect(view.user).toBeUndefined();
    // 密钥不进配置：装配层的 header 只是**环境引用**，真值在挂载前解析、只存在于运行期 config。
    expect(view.base).toMatchObject({
      providers: { ollama: { headers: { Authorization: "Bearer ${OLLAMA_API_KEY}" } } },
    });
    expect(JSON.stringify(described)).not.toContain("sk-deployment-secret");
    expect(view.secrets).toEqual([]);
  },
);

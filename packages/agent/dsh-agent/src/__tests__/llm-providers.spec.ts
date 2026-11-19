// LLM provider 的**配置行**装上去之后，设置页的读面（`settings/describe`）看得到什么。
//
// 判据只有一条：装配层 `configure(实现类, …)` 给的 provider（这里的 ollama）必须出现在
// `llm-pi-ai` 视图的 `base` 与 `value` 里——模型页按 `value` 的 `settingsPath` 判「配没配」，
// 缺了这一层，装配里配好的第三方 provider 在设置里永远是「未配置」。
//
// 不起浏览器、不走 wire：`settings/describe` 的 handler 打进真装配（`SettingSchema` + provider 行）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import {
  AppEnv,
  type AppEnvValues,
  RemoteHandlers,
  RemoteHandlersDefault,
} from "@morlay/zephyr-app";
import { provideSetting } from "@morlay/dsh-setting/server";
import { LaunchEnvironment } from "../contract/launch-environment.contract.ts";
import { afterAll, expect, it } from "vitest";
import { LlmDefault } from "../llm.service.ts";
import { LlmPiAi } from "../llm-pi-ai.service.ts";
import { provideLlmProviders } from "../llm-providers.provide.ts";

/** 只给数据根的运行环境（配置文档落在 `<dataDir>/settings.json`）。 */
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root, dev: true } as AppEnvValues;
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}

const opened: App[] = [];
const roots: string[] = [];

afterAll(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** `settings/describe` 的一个命名空间视图（只取用例读的字段）。 */
interface DescribeView {
  readonly ns: string;
  readonly value?: Record<string, unknown>;
  readonly base?: Record<string, unknown>;
  readonly user?: unknown;
  readonly secrets?: readonly unknown[];
}

it(
  "装配层配的 ollama route 出现在 `llm-pi-ai` 的 base 与生效值里",
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-agent-llm-"));
    roots.push(root);
    const app = await bootstrapApplication({
      providers: [
        { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
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
    opened.push(app);

    const result = (await app.get(RemoteHandlers).invoke("settings/describe", {})) as {
      ok?: boolean;
      value?: { namespaces: readonly DescribeView[] };
    };
    expect(result.ok).toBe(true);
    const view = result.value?.namespaces.find((entry) => entry.ns === "llm-pi-ai");
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
    expect(JSON.stringify(result)).not.toContain("sk-deployment-secret");
    expect(view.secrets).toEqual([]);
  },
);

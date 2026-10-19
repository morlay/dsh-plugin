// 配置面的局部闭环：一份 JSON 的读写 + `settings/*` 三个端点的真行为。
//
// 不起浏览器：`SettingEndpointDefault` 只是把文档投影成 UI 要的形状，用 `RemoteHandlers.invoke`
// 打进去就能验。落盘那份单独验「格式化」（2 空格缩进、末尾换行）——它是人能直接改的文件。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ThemeSettingsSchema,
  type ThemeSettings,
} from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { Llm } from "@morlay/dsh-agent";
import { Setting } from "../contract/setting.contract.ts";
import { provideSetting } from "../server/setting.provide.ts";

const opened: App[] = [];
const roots: string[] = [];

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

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function boot(existing?: string): Promise<{ app: App; root: string }> {
  const root = existing ?? (await mkdtemp(join(tmpdir(), "dsh-setting-")));
  if (existing === undefined) roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      // 类令牌用 `useFactory` 给实例（`useValue` 只对 `InjectionToken` 生效）。
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
      // `settings/describe` 的枚举源头是 provider 目录：装整个设置模块（含 `llm-deepseek` / `llm-pi-ai`
      // 两条注册行）与真 `Llm`（`provideAgent`）。
      ...provideAgent(),
      ...provideSetting(),
      RemoteHandlersDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { app, root };
}

/** `settings/describe` 的一个命名空间视图（wire 形状）。 */
interface DescribeView {
  readonly ns: string;
  readonly schema: unknown;
  readonly value: unknown;
  readonly user?: unknown;
  readonly revision: number;
}

/** `settings/describe` 的返回值（wire 形状）。 */
interface DescribeValue {
  readonly writable: boolean;
  readonly namespaces: readonly DescribeView[];
}

/**
 * 收窄 `settings/describe` 的返回值：逐字段 `typeof` 判，不用断言。
 * @param value - handler 返回的 `unknown`。
 * @returns 是否是可用的 describe 值。
 */
/** 把 wire 的 `RemoteResult` 解成值（三个端点都包了这层，客户端正是读 `.ok` 再取 `.value`）。 */
function unwrap<T>(result: unknown): T | undefined {
  const wire = result as { ok?: unknown; value?: unknown } | null | undefined;
  return wire?.ok === true ? (wire.value as T) : undefined;
}

function isDescribeView(entry: unknown): entry is DescribeView {
  if (typeof entry !== "object" || entry === null) return false;
  if (!("ns" in entry) || typeof entry.ns !== "string") return false;
  if (!("revision" in entry) || typeof entry.revision !== "number") return false;
  return "value" in entry && "schema" in entry;
}

function isDescribeValue(value: unknown): value is DescribeValue {
  if (typeof value !== "object" || value === null) return false;
  if (!("writable" in value) || typeof value.writable !== "boolean") return false;
  if (!("namespaces" in value) || !Array.isArray(value.namespaces)) return false;
  return value.namespaces.every(isDescribeView);
}

describe("配置面", () => {
  it("`update` 深合并（保留其余键），`replace` 整段覆盖（不留旧键）", async () => {
    const { app } = await boot();
    const setting = app.get(Setting);
    setting.update("llm-deepseek", { a: { b: 1 } });
    const merged = setting.update("llm-deepseek", { a: { c: 2 } });
    expect(merged.value).toEqual({ a: { b: 1, c: 2 } });
    const replaced = setting.replace("llm-deepseek", { a: { c: 2 } });
    expect(replaced.value).toEqual({ a: { c: 2 } });
    expect(setting.snapshot()["llm-deepseek"]).toEqual({ a: { c: 2 } });
  });

  it("`expectedRevision` 不匹配时抛 `settings/conflict`，`undefined` 表示不校验", async () => {
    const { app } = await boot();
    const setting = app.get(Setting);
    const first = setting.update("llm-deepseek", { a: 1 });
    expect(() => setting.update("llm-deepseek", { a: 2 }, first.revision - 1)).toThrow(/settings\/conflict/);
    expect(setting.update("llm-deepseek", { a: 3 }, first.revision).value).toEqual({ a: 3 });
    expect(setting.update("llm-deepseek", { a: 4 }).value).toEqual({ a: 4 });
  });

  it("`replace` 后 `snapshot` 读得回，落盘是格式化的 JSON", async () => {
    const { app, root } = await boot();
    app.get(Setting).replace("llm-deepseek", { apiKey: "sk-1", model: "deepseek-flash" });

    expect(app.get(Setting).snapshot()).toEqual({
      "llm-deepseek": { apiKey: "sk-1", model: "deepseek-flash" },
    });

    // 落盘是异步的：给它一拍再读。
    await new Promise((resolve) => setTimeout(resolve, 50));
    const text = await readFile(join(root, "settings.json"), "utf8");
    expect(text).toContain('  "llm-deepseek": {');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("`settings/describe` 按 provider 目录枚举（空文档也必须有每一条），`mutate` 之后能看到改动", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const handlers = app.get(RemoteHandlers);

    const empty = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
    if (!isDescribeValue(empty)) throw new Error("settings/describe 的返回值不是 describe 值");
    // 核心：枚举源头是 provider 目录，不是 `settings.json` 里的键——空文档时这两条也必须在。
    // 两条 provider 行的 `settingsNs`：`llm-deepseek-api-key`（`dsh-llm-deepseek-api-key` 的注册名）
    // 与 `llm-pi-ai`。UI 正是按 `listConfigurableProviders()` 里的同名 `settingsNs` 查视图。
    expect(empty.namespaces.map((view) => view.ns)).toEqual(
      expect.arrayContaining(["llm-deepseek-api-key", "llm-pi-ai"]),
    );
    // 空文档时 `value` 只有 schema 默认层（`apiKeyEnv` 的 default 就是这条 provider 的部署默认），
    // 而 `user` 没有——默认层不能冒充「用户改过」。
    const untouched = empty.namespaces.find((view) => view.ns === "llm-deepseek-api-key");
    expect(untouched?.user).toBeUndefined();
    expect(untouched?.value).toMatchObject({ apiKeyEnv: "DEEPSEEK_API_KEY" });

    await handlers.invoke("settings/mutate", {
      ns: "llm-deepseek-api-key",
      ops: [
        { op: "set", path: ["apiKey"], value: "sk-2" },
        { op: "set", path: ["nested", "model"], value: "deepseek-flash" },
        { op: "unset", path: ["nested", "model"] },
      ],
    });

    const described = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");
    const view = described.namespaces.find((entry) => entry.ns === "llm-deepseek-api-key");
    // 用户层原样（`value` 是默认层 ⊕ 用户层，用户层只放用户写过的键）。
    expect(view?.user).toEqual({ apiKey: "sk-2", nested: {} });
    expect(view?.value).toMatchObject({ apiKey: "sk-2", nested: {} });
    expect(view?.revision).toBe(1);
  });

  it("`settings/openSettingsDocument` 只回打开标记，不暴露宿主路径", async () => {
    const { app } = await boot();
    await expect(app.get(RemoteHandlers).invoke("settings/openSettingsDocument", {})).resolves.toEqual({ ok: true, value: { opened: true } });
  });
});

describe("配置文档的落盘与重建", () => {
  it("视图的 `schema` 是序列化后的 schemastery（不是 `null`，UI 要 `new Schema(json)`）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const described = unwrap<unknown>(await app.get(RemoteHandlers).invoke("settings/describe", {}));
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");
    const view = described.namespaces.find((entry) => entry.ns === "llm-deepseek-api-key");
    // schemastery 的 `toJSON()` 是 `{ uid, refs }`；`null` 会让 UI 的 `new Schema(null)` 崩在 `null.refs`。
    expect(view?.schema).toMatchObject({ refs: expect.any(Object) });
    expect(view?.schema).not.toBeNull();
  });

  it("`replace` 落盘；重建整套实例后仍读得回（重启不丢）", { timeout: 20_000 }, async () => {
    const first = await boot();
    first.app.get(Setting).replace("llm-deepseek-api-key", { apiKey: "sk-persist" });
    // `SettingLoader.onDispose` 会 await 写盘队列；先卸载，模拟进程结束。
    await first.app.dispose();

    const second = await boot(first.root);
    expect(second.app.get(Setting).snapshot()).toMatchObject({
      "llm-deepseek-api-key": { apiKey: "sk-persist" },
    });
    await second.app.dispose();
  });
});

describe("命名空间视图的用户层", () => {
  it("`ui-theme` 的 `value` 与 `user` 都带上写进去的 `preference`", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    app.get(Setting).replace("ui-theme", { preference: "dark" });

    const described = unwrap<unknown>(await app.get(RemoteHandlers).invoke("settings/describe", {}));
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");
    const view = described.namespaces.find((entry) => entry.ns === "ui-theme");
    expect(view?.value).toMatchObject({ preference: "dark" });
    expect(view?.user).toEqual({ preference: "dark" });
  });
});

// 「前端设置后刷新就重置」的回归判据：`describe` 的 `value` 必须 = **schema 默认值 ⊕ 用户值**。
//
// 客户端 `ui-theme` 的 `ThemeRuntime.adopt` 直接读 `configForms.get('ui-theme').getSnapshot().value`
// 并把三个字体字段交给 `normalizeFontFamily`（`value.split(',')`）；缺任何一字段就在浏览器里抛
// `Cannot read properties of undefined (reading 'split')`，主题于是停在默认值——「改了、写通了、刷新就没了」。
// 所以这里断言的是 **wire 面**（`RemoteHandlers.invoke`）上的完整值，不是内部字段。
describe("`ui-theme` 视图的默认层", () => {
  /** 上游 `ThemeSettingsSchema` 声明的全部字段与默认值（`theme-settings.ts` 的 durable schema）。 */
  const themeDefaults = {
    preference: "system",
    fontSize: 14,
    codeFontSize: 11,
    terminalFontSize: 13,
    textFontFamily: "",
    codeFontFamily: "",
    terminalFontFamily: "",
  };

  it("`describe` 的 `value` 是 schema 默认值 ⊕ 用户值（没写过的字段回落到 schema 默认）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const described = unwrap<unknown>(await app.get(RemoteHandlers).invoke("settings/describe", {}));
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");

    const view = described.namespaces.find((entry) => entry.ns === "ui-theme");
    if (view === undefined) throw new Error("settings/describe 里没有 ui-theme 的视图");
    // 一个字段都不能缺：字体三项就是浏览器里崩在 `normalizeFontFamily` 的那三项。
    expect(view.value).toEqual(themeDefaults);
    // 用户层没写过就是没有（`value` 的默认层不能冒充用户改过）。
    expect(view.user).toBeUndefined();
    // schema 是上游 durable theme schema，不是没注册时的兜底 `{type:"object",dict:{}}`：
    // 客户端 `ConfigFormController.decode` 用 `new Schema(view.schema)` 校验这份值，校验不过就当没有配置。
    expect(view.schema).toEqual(ThemeSettingsSchema.toJSON());
    expect(() => ThemeSettingsSchema(view.value as ThemeSettings)).not.toThrow();
  });

  it("写一次 `mutate` 后重新 `describe` 读得回新值，其余字段仍是 schema 默认", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const handlers = app.get(RemoteHandlers);

    // 第一处断言的是**写回答**：客户端把 `mutate` 的回答折进 mirror 后立刻 `adopt()`，
    // 回答里缺字体字段就是用户看到的那次崩（写通、读塌）。
    const written = unwrap<unknown>(await handlers.invoke("settings/mutate", {
      ns: "ui-theme",
      ops: [{ op: "set", path: ["preference"], value: "light" }],
    }));
    if (!isDescribeView(written)) throw new Error("settings/mutate 的返回值不是命名空间视图");
    expect(written.value).toEqual({ ...themeDefaults, preference: "light" });

    // 第二处断言的是「刷新读回」：重新 `describe`（浏览器刷新后的那一条读）看到的是新值。
    const described = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");
    const view = described.namespaces.find((entry) => entry.ns === "ui-theme");
    expect(view?.value).toEqual({ ...themeDefaults, preference: "light" });
    expect(view?.user).toEqual({ preference: "light" });
  });
});



describe("llm-pi-ai 的配置生效", () => {
  it("启动时应用持久化配置：`settings.json` 里的 providers 进到那一行（模型目录能看到）", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-setting-pi-ai-"));
    roots.push(root);
    // 启动前就有人在文件里写好了 route（reload 后的常态）。
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        "llm-pi-ai": {
          providers: {
            ollama: {
              displayName: "Ollama Cloud",
              api: "openai-completions",
              baseURL: "https://ollama.com/v1",
              models: [{ id: "m1", name: "Model One" }],
            },
          },
        },
      }),
      "utf8",
    );
    const { app } = await boot(root);
    const llm = app.get(Llm);
    const providers = await llm.listProviders();
    expect(providers.map((one) => one.id)).toContain("ollama");
    // 只看目录里有没有这条 route：`discoverModels` 走的是上游 pi-ai 的端点探测，与本条的判据无关。
    expect((await llm.listProviders()).find((one) => one.id === "ollama")?.name).toBe("Ollama Cloud");
  });


});

// 配置面的局部闭环：一份 JSON 的读写 + `settings/*` 三个端点的真行为。
//
// 不起浏览器：`SettingEndpointDefault` 只是把文档投影成 UI 要的形状，用 `RemoteHandlers.invoke`
// 打进去就能验。落盘那份单独验「格式化」（2 空格缩进、末尾换行）——它是人能直接改的文件。
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ThemeSettingsSchema,
  type ThemeSettings,
} from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import {
  bootstrapApplication,
  type App,
  inject,
  Injectable,
  type ProviderEntry,
} from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { Setting, SettingSchema, UiSettingsPreferences, UiThemeSchema } from "@morlay/zephyr-app";
import { provideSetting } from "../server/setting.provide.ts";

/** 假的注册行：只往 `SettingSchema` 里登记一个 namespace（证明枚举来源是注册表）。 */
@Injectable()
class FakeRegisteredSetting {
  private readonly schemas = inject(SettingSchema);

  onInit(): void {
    // 注册的是**活 schema**（注册表要 `toJSON()` 算默认值、要节点结构脱敏）。这里用最小形状
    // （`refs` 非空即够）——真实的 provider 行由各自域注册。
    this.schemas.register("fake-provider", {
      toJSON: () => ({ uid: 1, refs: { 1: { type: "object" } } }),
    });
  }
}

/** 只给数据根的运行环境（配置文档落在 `<dataDir>/settings.json`）。 */
async function boot(
  existing?: string,
  extra: readonly ProviderEntry[] = [],
): Promise<{ app: App; root: string }> {
  const root = existing ?? (await mkdtemp(join(tmpdir(), "dsh-setting-")));
  if (existing === undefined) onTestFinished(() => rm(root, { recursive: true, force: true }));
  const app = await bootstrapApplication({
    providers: [
      ...extra,
      // 类令牌用 `useFactory` 给实例（`useValue` 只对 `InjectionToken` 生效）。
      { provide: AppEnv, useValue: createTestingAppEnv({ root: root }) },
      // 只装设置模块自己的东西：`describe` 的枚举源头是 **schema 注册表**，
      // 别的域（LLM provider / session / agent）不在这里出现——那是它们各自的用例该管的。
      ...provideSetting(),
      // 一个**假的注册行**：证明「注册了 schema 的 namespace 就会出现在 `describe` 里」，
      // 不需要装真的 LLM provider（那属于 `dsh-agent` 的用例）。
      FakeRegisteredSetting,
      // 两个具体设置项由框架层注册（`ui-theme` 的 schema 与 `ui-settings` 命名空间）。
      UiThemeSchema,
      UiSettingsPreferences,
      RemoteHandlersDefault,
    ],
    timeoutMs: 20_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return { app, root };
}

/** `settings/describe` 的一个命名空间视图（wire 形状）。 */
interface DescribeView {
  readonly ns: string;
  readonly schema: unknown;
  readonly value: unknown;
  /** 装配层（行 config），没有就是 `{}`。 */
  readonly base: unknown;
  readonly user?: unknown;
  /** schema 声明的密钥位与「有没有值」。 */
  readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[];
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
/**
 * 从 `handlers.invoke(...)` 的返回值取业务值。**两种口径都认**：
 *
 * - 我们的端点回**裸值**（`describe` / `mutate` …；`RemoteResult` 由桥与客户端面各包一层）；
 * - 上游 `typertGateway` 分派的 `@Remote` 方法同样是裸值，但如果某个端点在测试装配里走了桥，
 *   拿到的是 `{ ok: true, value }`。
 *
 * 只认包装的话，我们这一侧的断言会一律读到 `undefined`（本文件 8 处用例就这么红过）。
 * @param result - `handlers.invoke(...)` 的返回值。
 * @returns 业务值；`ok: false` 回 `undefined`。
 */
function unwrap<T>(result: unknown): T | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if (!("ok" in result)) return result as T;
  const wire = result as { ok?: unknown; value?: unknown };
  return wire.ok === true ? (wire.value as T) : undefined;
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
  test("`update` 深合并（保留其余键），`replace` 整段覆盖（不留旧键）", async () => {
    const { app } = await boot();
    const setting = app.get(Setting);
    setting.update("llm-deepseek", { a: { b: 1 } });
    const merged = setting.update("llm-deepseek", { a: { c: 2 } });
    expect(merged.value).toEqual({ a: { b: 1, c: 2 } });
    const replaced = setting.replace("llm-deepseek", { a: { c: 2 } });
    expect(replaced.value).toEqual({ a: { c: 2 } });
    expect(setting.snapshot()["llm-deepseek"]).toEqual({ a: { c: 2 } });
  });

  test("`expectedRevision` 不匹配时抛 `settings/conflict`，`undefined` 表示不校验", async () => {
    const { app } = await boot();
    const setting = app.get(Setting);
    const first = setting.update("llm-deepseek", { a: 1 });
    expect(() => setting.update("llm-deepseek", { a: 2 }, first.revision - 1)).toThrow(
      /settings\/conflict/,
    );
    expect(setting.update("llm-deepseek", { a: 3 }, first.revision).value).toEqual({ a: 3 });
    expect(setting.update("llm-deepseek", { a: 4 }).value).toEqual({ a: 4 });
  });

  test("`replace` 后 `snapshot` 读得回，落盘是格式化的 JSON", async () => {
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

  test(
    "`settings/describe` 按 provider 目录枚举（空文档也必须有每一条），`mutate` 之后能看到改动",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const handlers = app.get(RemoteHandlers);

      const empty = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
      if (!isDescribeValue(empty)) throw new Error("settings/describe 的返回值不是 describe 值");
      // 核心：枚举源头是 **schema 注册表**，不是 `settings.json` 里的键——空文档时也必须在。
      // 这里用假注册行注册的 `fake-provider` 验证该行为；真的 LLM provider 在 `dsh-agent` 的用例里。
      expect(empty.namespaces.map((view) => view.ns)).toEqual(
        expect.arrayContaining(["fake-provider"]),
      );
      // 空文档时 `user` 没有——默认层不能冒充「用户改过」。
      const untouched = empty.namespaces.find((view) => view.ns === "fake-provider");
      expect(untouched?.user).toBeUndefined();

      await handlers.invoke("settings/mutate", {
        ns: "fake-provider",
        ops: [
          { op: "set", path: ["apiKey"], value: "sk-2" },
          { op: "set", path: ["nested", "model"], value: "deepseek-flash" },
          { op: "unset", path: ["nested", "model"] },
        ],
      });

      const described = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const view = described.namespaces.find((entry) => entry.ns === "fake-provider");
      // 用户层原样（`value` 是默认层 ⊕ 用户层，用户层只放用户写过的键）。
      expect(view?.user).toEqual({ apiKey: "sk-2", nested: {} });
      expect(view?.value).toMatchObject({ apiKey: "sk-2", nested: {} });
      expect(view?.revision).toBe(1);
    },
  );

  test("`settings/openSettingsDocument` 只回打开标记，不暴露宿主路径", async () => {
    const { app } = await boot();
    await expect(
      app.get(RemoteHandlers).invoke("settings/openSettingsDocument", {}),
      // 裸值口径；退化成包装时这里会拿到 `{ ok: true, value: { opened: true } }`（双包）。
    ).resolves.toEqual({ opened: true });
  });
});

describe("配置文档的落盘与重建", () => {
  test(
    "视图的 `schema` 是序列化后的 schemastery（不是 `null`，UI 要 `new Schema(json)`）",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const described = unwrap<unknown>(
        await app.get(RemoteHandlers).invoke("settings/describe", {}),
      );
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const view = described.namespaces.find((entry) => entry.ns === "fake-provider");
      // schemastery 的 `toJSON()` 是 `{ uid, refs }`；`null` 会让 UI 的 `new Schema(null)` 崩在 `null.refs`。
      expect(view?.schema).toMatchObject({ refs: expect.any(Object) });
      expect(view?.schema).not.toBeNull();
    },
  );

  test("`replace` 落盘；重建整套实例后仍读得回（重启不丢）", { timeout: 20_000 }, async () => {
    const first = await boot();
    first.app.get(Setting).replace("fake-provider", { apiKey: "sk-persist" });
    // `SettingLoader.onDispose` 会 await 写盘队列；先卸载，模拟进程结束。
    await first.app.dispose();

    const second = await boot(first.root);
    expect(second.app.get(Setting).snapshot()).toMatchObject({
      "fake-provider": { apiKey: "sk-persist" },
    });
    await second.app.dispose();
  });
});

describe("命名空间视图的用户层", () => {
  test(
    "`ui-theme` 的 `value` 与 `user` 都带上写进去的 `preference`",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      app.get(Setting).replace("ui-theme", { preference: "dark" });

      const described = unwrap<unknown>(
        await app.get(RemoteHandlers).invoke("settings/describe", {}),
      );
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const view = described.namespaces.find((entry) => entry.ns === "ui-theme");
      expect(view?.value).toMatchObject({ preference: "dark" });
      expect(view?.user).toEqual({ preference: "dark" });
    },
  );
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

  test(
    "`describe` 的 `value` 是 schema 默认值 ⊕ 用户值（没写过的字段回落到 schema 默认）",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const described = unwrap<unknown>(
        await app.get(RemoteHandlers).invoke("settings/describe", {}),
      );
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");

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
    },
  );

  test(
    "写一次 `mutate` 后重新 `describe` 读得回新值，其余字段仍是 schema 默认",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const handlers = app.get(RemoteHandlers);

      // 第一处断言的是**写回答**：客户端把 `mutate` 的回答折进 mirror 后立刻 `adopt()`，
      // 回答里缺字体字段就是用户看到的那次崩（写通、读塌）。
      const written = unwrap<unknown>(
        await handlers.invoke("settings/mutate", {
          ns: "ui-theme",
          ops: [{ op: "set", path: ["preference"], value: "light" }],
        }),
      );
      if (!isDescribeView(written)) throw new Error("settings/mutate 的返回值不是命名空间视图");
      expect(written.value).toEqual({ ...themeDefaults, preference: "light" });

      // 第二处断言的是「刷新读回」：重新 `describe`（浏览器刷新后的那一条读）看到的是新值。
      const described = unwrap<unknown>(await handlers.invoke("settings/describe", {}));
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const view = described.namespaces.find((entry) => entry.ns === "ui-theme");
      expect(view?.value).toEqual({ ...themeDefaults, preference: "light" });
      expect(view?.user).toEqual({ preference: "light" });
    },
  );
});

describe("上游按 `ctx.settings` 取配置面", () => {
  test("`settings` 发布到根，`configure` 可声明呈现并可撤销", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const settings = app.ctx.get("settings", false) as Setting | undefined;
    expect(settings, "上游按这个名字 inject，没有它那些行永远不激活").toBeDefined();
    expect(typeof settings?.configure, "`configure` 是上游构造期就调的方法").toBe("function");

    const owner = {};
    const dispose = settings?.configure({ auto: false }, owner);
    expect(typeof dispose).toBe("function");
    // 幂等：撤销两次不抛。
    dispose?.();
    dispose?.();
  });

  test(
    "`ui-settings` 命名空间在 `describe` 里（`developerTools.enabled` 的来源）",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();
      const described = unwrap<unknown>(
        await app.get(RemoteHandlers).invoke("settings/describe", {}),
      );
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const names = described.namespaces.map((entry) => entry.ns);
      expect(names).toContain("ui-settings");
      // 轨迹视图的可见性直接读它：`!configForms.developerTools.enabled && id === 'trajectory'` 就过滤掉。
      expect(described.namespaces.find((entry) => entry.ns === "ui-settings")?.value).toMatchObject(
        {
          enabled: true,
        },
      );
    },
  );
});

// 视图的**三层**与**密钥脱敏**：设置页要能看见装配层配好的 provider（否则模型页永远显示「未配置」），
// 同时密钥只写不读——`value`/`base`/`user` 里都不出现密钥值，`secrets` 只说位置与「有没有值」。
//
// 假行同时给出两样东西：活的节点结构（`type`/`dict`/`meta.role`，脱敏按它走）与 `toJSON()`
// （默认值树与 UI 的表单 schema 按它走）。真实的 provider 行在 `@morlay/dsh-agent` 的用例里。
const LAYERED_SCHEMA = {
  type: "object",
  dict: {
    apiKey: { type: "string", meta: { role: "secret" } },
    providers: {
      type: "dict",
      inner: { type: "object", dict: { baseURL: { type: "string" } } },
    },
  },
  toJSON: () => ({
    uid: 1,
    refs: {
      "1": { type: "object", dict: { apiKey: "2", providers: "3" } },
      "2": { type: "string", meta: { role: "secret" } },
      "3": { type: "dict" },
    },
  }),
};

/** 一条带**装配层**（行 config）与密钥槽的注册行。 */
@Injectable()
class FakeLayeredSetting {
  private readonly schemas = inject(SettingSchema);

  onInit(): void {
    this.schemas.register("fake-layered", LAYERED_SCHEMA, {
      apiKey: "deployment-key",
      providers: { ollama: { baseURL: "https://ollama.com" } },
    });
  }
}

describe("视图的三层（schema 默认 → 装配层 → 用户层）", () => {
  test("装配层进 `value` 与 `base`，密钥只写不读", { timeout: 20_000 }, async () => {
    const { app } = await boot(undefined, [FakeLayeredSetting]);
    const described = unwrap<unknown>(
      await app.get(RemoteHandlers).invoke("settings/describe", {}),
    );
    if (!isDescribeValue(described)) throw new Error("settings/describe 的返回值不是 describe 值");
    const view = described.namespaces.find((entry) => entry.ns === "fake-layered");
    if (view === undefined) throw new Error("settings/describe 里没有 fake-layered 的视图");

    // 生效值里有装配层：模型页按 `value` 的 `settingsPath` 判「这个 provider 配没配」。
    expect(view.value).toEqual({ providers: { ollama: { baseURL: "https://ollama.com" } } });
    // `base` 就是装配层（行 config），同样脱敏。
    expect(view.base).toEqual({ providers: { ollama: { baseURL: "https://ollama.com" } } });
    // 用户没写过：`user` 不能拿装配层冒充。
    expect(view.user).toBeUndefined();
    // 密钥只写不读：值里没有它，位置与「有没有值」由 `secrets` 说。
    expect(view.secrets).toEqual([{ path: ["apiKey"], set: true }]);
  });

  test(
    "用户层与装配层并存：`user` 只放用户写的那份，`value` 三层合并",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot(undefined, [FakeLayeredSetting]);
      app.get(Setting).replace("fake-layered", {
        providers: { openai: { baseURL: "https://api.openai.com/v1" } },
      });

      const described = unwrap<unknown>(
        await app.get(RemoteHandlers).invoke("settings/describe", {}),
      );
      if (!isDescribeValue(described))
        throw new Error("settings/describe 的返回值不是 describe 值");
      const view = described.namespaces.find((entry) => entry.ns === "fake-layered");
      expect(view?.user).toEqual({
        providers: { openai: { baseURL: "https://api.openai.com/v1" } },
      });
      // 用户的 provider 与装配层的 provider 并存（dict 逐键合并，不是整段覆盖）。
      expect(view?.value).toEqual({
        providers: {
          ollama: { baseURL: "https://ollama.com" },
          openai: { baseURL: "https://api.openai.com/v1" },
        },
      });
    },
  );
});

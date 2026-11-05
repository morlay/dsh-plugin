// 配置面的局部闭环：一份 JSON 的读写 + `settings/*` 三个端点的真行为。
//
// 不起浏览器：`SettingEndpointDefault` 只是把文档投影成 UI 要的形状，用 `RemoteHandlers.invoke`
// 打进去就能验。落盘那份单独验「格式化」（2 空格缩进、末尾换行）——它是人能直接改的文件。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ThemeSettingsSchema,
  type ThemeSettings,
} from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { bootstrapApplication, type App, inject, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { Setting, SettingSchema, UiSettingsPreferences, UiThemeSchema } from "@morlay/zephyr-app";
import { provideSetting } from "../server/setting.provide.ts";

/** 假的注册行：只往 `SettingSchema` 里登记一个 namespace（证明枚举来源是注册表）。 */
@Injectable()
class FakeRegisteredSetting {
  private readonly schemas = inject(SettingSchema);

  onInit(): void {
    // 注册的是 **schemastery 的序列化**（`toJSON(): { uid, refs }`），UI 用 `new Schema(json)` 还原。
    // 这里用最小形状（`refs` 非空即够）——真实的 provider 行由各自域注册。
    this.schemas.register("fake-provider", { uid: 1, refs: { 1: { type: "object" } } });
  }
}

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
    providers: [
      // 类令牌用 `useFactory` 给实例（`useValue` 只对 `InjectionToken` 生效）。
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
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
    expect(() => setting.update("llm-deepseek", { a: 2 }, first.revision - 1)).toThrow(
      /settings\/conflict/,
    );
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

  it(
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

  it("`settings/openSettingsDocument` 只回打开标记，不暴露宿主路径", async () => {
    const { app } = await boot();
    await expect(
      app.get(RemoteHandlers).invoke("settings/openSettingsDocument", {}),
    ).resolves.toEqual({ ok: true, value: { opened: true } });
  });
});

describe("配置文档的落盘与重建", () => {
  it(
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

  it("`replace` 落盘；重建整套实例后仍读得回（重启不丢）", { timeout: 20_000 }, async () => {
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
  it(
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

  it(
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

  it(
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
  it("`settings` 发布到根，`configure` 可声明呈现并可撤销", { timeout: 20_000 }, async () => {
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

  it(
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

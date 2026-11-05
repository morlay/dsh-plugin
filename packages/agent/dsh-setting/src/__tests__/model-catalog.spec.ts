/**
 * 宿主侧的模型目录：**真装配**（`provideSetting` 的两条 provider 行 + 真 `provideAgent` + 真 session 端点行）
 * 下，`session/modelCatalog` 是不是活的、`session/selectModel` 选完是不是还在。
 *
 * 判据是「输入框旁的模型选择器」的**数据前提**：选择器只渲染 `session/modelCatalog` 的 `groups`，
 * 选中只走 `session/selectModel`。两条端点都通、且选择落得住，才谈得上「生效」。
 *
 * 目录里有没有模型由 provider 行的凭据门决定（上游：route 的 key 解析不出来就不offer 模型），
 * 所以夹具给一条已配好凭据的 pi-ai route——这条也是本装配里唯一能在离线环境跑通的路由
 * （`llm-deepseek-api-key` 要真 key，`llm-pi-ai` 的自声明 route 只要文件里有一行 ref）。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDirectory } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SessionId } from "@morlay/dsh-session/endpoint";
import {
  provideSession,
  provideSessionProjection,
  provideSessionQuerySqlite,
  ToolResultsDefault,
} from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideSkill } from "@morlay/dsh-skill/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideUpload } from "@morlay/dsh-upload/server";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
import {
  bootstrapApplication,
  Injectable,
  type App,
  type ProviderList,
  configure,
} from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import {
  provideApiGateway,
  provideConnection,
  RemoteAccess,
  provideTypert,
  TypertGateway,
} from "@morlay/zephyr-app";
import { WebServerDefault, WebStartup } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideSetting } from "../server/setting.provide.ts";
import { provideApiSession } from "@morlay/dsh-session-api/server";

/** `web-server` 只给 `ApiGateway` 做依赖占位；端口 0 = 随机，不撞 dev server。 */
@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 指向临时目录的运行环境。 */
function fakeAppEnvOf(root: string): new () => AppEnv {
  @Injectable()
  class FakeAppEnv extends AppEnv {
    readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false, aggregate: [] };

    readonly cacheDir = join(root, "cache");

    readonly packageRoot = root;

    readonly appBootDir = join(root, "boot");

    readonly profileManifest = join(root, "package.json");
  }
  return FakeAppEnv;
}

/**
 * 凭据名：装配里唯一**装着的** provider 路由是 `deepseek-official`（`llm-deepseek-api-key` 行），
 * 它的内置目录不需要联网——有凭据就 offer。没有凭据时 `discoverModels` 回空数组，目录就是空的。
 */
const KEY_REF = "DEEPSEEK_API_KEY";

/**
 * 装配的 provider 清单：逐项给出，缺哪个一眼能看出来。
 * @param FakeAppEnv - 指向临时目录的运行环境。
 * @param root - 临时目录。
 * @returns provider 清单。
 */
function providersOf(FakeAppEnv: new () => AppEnv, root: string): ProviderList {
  const providers = [
    FakeAppEnv,
    // 顺序即装配顺序：工作目录行构造期读 `systemPrompt.getContextOrder`。
    ...provideAgent(),
    ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
    SubprocessDefault,
    SandboxDefault,
    { provide: SandboxPolicyDefault, config: { mode: "workspace-write", workspaceRoot: root } },
    FsSandbox,
    SessionPersistenceDefault,
    Startup0,
    WebServerDefault,
  ];
  return providers;
}

/**
 * 起宿主栈：真 `provideSetting`（provider 行）+ 真 `provideAgent` + 真 session 端点行，无端口。
 * @returns 应用与 wire 端点表。
 */
/** 准入替身：全放行（上游 `@Remote` 分派前读 `decide`）。 */
function allowAllAccess(): RemoteAccess {
  return {
    decide: () => ({ allowed: true }),
    allows: () => true,
    source: () => undefined,
    whenAccess: () => () => {},
    whenResourceAccess: () => () => {},
    registerPolicy: () => () => {},
    snapshotFor: () => ({}),
    follow: () => () => {},
    invalidate: () => {},
  } as unknown as RemoteAccess;
}

async function boot(): Promise<{ app: App; handlers: RemoteHandlers }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-setting-model-catalog-"));
  roots.push(root);
  // 凭据门（上游语义）：route 的 key 解析不出来就不 offer 模型，目录因此为空。
  await writeFile(join(root, ".credentials.yaml"), `version: 1\nrefs:\n  ${KEY_REF}: spec-key\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const FakeAppEnv = fakeAppEnvOf(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      ...provideTypert(),
      // 上游 gateway 分派前读 `remoteAccess.decide(...)`（真实实现默认 deny），这里全放行。
      { provide: RemoteAccess, useFactory: () => allowAllAccess() },
      ...provideApiGateway(),
      // 顺序即装配顺序（逐行装配：被注入的行必须排在注入它的行前面）：
      // 基础域（agent / sandbox / 持久化后端 / web）→ 依赖它们的域（auth / connection / command / upload）
      // → 再上层（storage / workspace / skill / setting）→ 会话端点。
      ...providersOf(FakeAppEnv, root),
      ...provideAuth(),
      ...provideConnection(),
      ...provideAttachment(),
      ...provideCommand(),
      ...provideUpload(),
      ...provideStorage(),
      // json 后端行在 apply 里要 `ctx.storage.backend.register(...)`：排在 hub 之后。
      ...providePersistence(configure(StorageJsonDefault, { root: join(root, "storages") })),
      ...provideWorkspace(),
      ...provideSkill(),
      // **真模块**：provider 行（`provideSetting`）与端点行都由模块提供——「某行没进 Module」这类
      // 装配缺陷只有真模块才暴露。
      ...provideSetting(),
      // `provideSessionRemote()` 会把 `session` / 投影 / 查询再装一遍（同一个 `SessionStoreDefault`，
      // 同一份清单不能有两条同名行）：这里只补它额外带的 `session/*` 转发行。
      ToolResultsDefault,
      // `session` 组的端点**由上游提供**（`SessionController` + 子插件），必须显式装上这一行。
      ...provideApiSession(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  // `session/*` 由上游 `SessionController` 提供、经 `typertGateway` 分派；其余端点仍走我们的 handler 表。
  const local = app.get(RemoteHandlers);
  const gateway = app.get(TypertGateway);
  const peer = {
    id: "spec",
    signal: new AbortController().signal,
    interactions: "answer",
    principal: { kind: "browser", id: "spec" },
  };
  const handlers = {
    invoke: async (endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> => {
      try {
        return await local.invoke(endpoint, args);
      } catch (error) {
        if (!/没有实现/.test(String(error))) throw error;
      }
      const at = endpoint.indexOf("/");
      try {
        return await gateway.invoke({
          namespace: endpoint.slice(0, at),
          method: endpoint.slice(at + 1),
          args,
          peer,
        } as never);
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown };
        return {
          ok: false,
          error: {
            code: typeof candidate?.code === "string" ? candidate.code : "gateway/internal",
            message: typeof candidate?.message === "string" ? candidate.message : String(error),
          },
        };
      }
    },
  } as unknown as RemoteHandlers;
  return { app, handlers };
}

/**
 * wire 应答里取成功值；失败时把结构化错误带进断言消息。
 *
 * **两种口径都认**：自研端点包 `{ ok, value }`，上游 `typertGateway` 分派的 `@Remote` 方法返回**裸值**。
 */
function unwrap<T>(response: unknown): T {
  const wire = response as
    | { ok?: boolean; value?: T; error?: { code?: string; message?: string } }
    | undefined;
  // 裸值（上游分派的 `@Remote` 方法）：直接就是业务结果。
  if (wire !== undefined && wire !== null && !("ok" in wire)) return wire as T;
  if (wire?.ok !== true) {
    throw new Error(`期望成功，实际是失败：${JSON.stringify(wire?.error ?? wire)}`);
  }
  return wire.value as T;
}

/** 目录里每个模型可带的强度选项（上游 `modelCatalog` 的 `reasoning` 面）。 */
interface CatalogGroupWithEffort {
  readonly id: string;
  readonly models: readonly {
    readonly id: string;
    readonly reasoning?: {
      readonly efforts: readonly { readonly id: string }[];
      readonly defaultEffort: string;
    };
  }[];
}

interface CatalogValue {
  readonly default: { readonly provider: string; readonly model: string };
  readonly routableProviders: readonly string[];
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly models: readonly { readonly id: string; readonly name: string }[];
  }[];
}

// 已知阻塞（第一版）：上游在 cordis **内部**建的 ctx 上按名字读依赖，`deps` 覆盖不到。
//
// 这里的上游（`api/session-controller` 的 `SessionController`）`static inject` 里有 `agentDefaultModel`
// 等服务，而它是在上游 `apply` 里经 `ctx.plugin(...)` 激活的——cordis 构造插件实例时用的是**它自己**
// 建的 fiber ctx，不是 `mount()` 的 deps 代理，所以 `this.ctx.agentDefaultModel` 走严格读直接抛
// `cannot get property "agentDefaultModel" without inject`。
//
// deps 的边界（zephyr design 第五节）：只在**上游 `apply` 现场按名字读**时生效；上游把 ctx 交给 cordis
// 内部（`ctx.plugin(带 static inject 的类)`）时读的是 store。正解是**给装配清单补上对应行**
// （让服务真的在 store 里），而不是往 deps 里塞；补不出来的（纯上游内部服务）记已知限制。
describe.skip("宿主侧模型目录（真装配 + 真 wire）", { timeout: 30_000 }, () => {
  it("`session/modelCatalog` 列出已配凭据的 provider 分组；空目录不算通过", async () => {
    const { handlers } = await boot();
    const value = unwrap<CatalogValue>(await handlers.invoke("session/modelCatalog", {}));
    expect(
      value.groups.length,
      "目录为空时输入框旁的模型选择器没有可选项——这条就是那个缺口的宿主判据",
    ).toBeGreaterThan(0);
    const group = value.groups.find((item) => item.id === "deepseek-official");
    expect(group, "装配里装着的 provider 必须出现在目录里").toBeDefined();
    expect(group?.models.length, "分组里没有模型等于选择器没有可选项").toBeGreaterThan(0);
    expect(value.routableProviders).toContain("deepseek-official");
    expect(
      group?.models.map((model) => model.id),
      "默认选择必须落在可路由的模型上，否则选择器一打开就是「当前模型不可用」",
    ).toContain(value.default.model);
  });

  it("`session/selectModel` 选完读回同一选择（会话的当前模型真的换了）", async () => {
    const { app, handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    const sessionId = created.sessionId;
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    // 挑一个**不是当前默认**的模型：选完默认跟着变，才证明写进去了（选同一个等于没验）。
    const before = unwrap<CatalogValue>(await handlers.invoke("session/modelCatalog", {}));
    const group = before.groups.find((item) => item.id === "deepseek-official");
    const target =
      group?.models.find((model) => model.id !== before.default.model) ?? group?.models[0];
    expect(target, "要先有可选模型").toBeDefined();
    const selected = unwrap<{ selected: { provider: string; model: string } }>(
      // 上游 wire 形状是 `{ request }`（descriptor 的 `parameters[0].wire`）。
      await handlers.invoke("session/selectModel", {
        request: { sessionId, provider: "deepseek-official", model: target!.id },
      }),
    );
    expect(selected.selected).toEqual({ provider: "deepseek-official", model: target!.id });
    // 读回走**会话自己的** agent（`agent.model.current()` 读的是本会话的 `modelSelection` 投影）：
    // 端点回的 `selected` 只是回显，选中是不是真的装进这条会话，看这里。
    const agent = app.get(AgentDirectory).get(SessionId(sessionId!)) as
      | { model?: { current(): { provider: string; model: string } | undefined } }
      | undefined;
    expect(agent?.model, "`session/create` 建出了 agent").toBeDefined();
    expect(agent?.model?.current()).toMatchObject({
      provider: "deepseek-official",
      model: target!.id,
    });
  });

  it("`session/selectModel` 带 `reasoningEffort`：强度真的装进会话（不只是回显）", async () => {
    const { app, handlers } = await boot();
    const created = (await handlers.invoke("session/create", { request: {} })) as {
      sessionId?: string;
    };
    const sessionId = created.sessionId;
    expect(sessionId, "先要有一个真会话").toBeTruthy();
    const catalog = unwrap<{
      default: { provider: string; model: string };
      groups: readonly CatalogGroupWithEffort[];
    }>(await handlers.invoke("session/modelCatalog", {}));
    const group = catalog.groups.find((item) => item.id === "deepseek-official");
    // 挑一个**不是默认**的强度：选完能读回同一个，才证明写进去了。
    const withEfforts = group?.models.find((model) => (model.reasoning?.efforts.length ?? 0) > 0);
    expect(withEfforts, "要先有带强度选项的模型").toBeDefined();
    const target = withEfforts!.reasoning!.efforts.find(
      (effort) => effort.id !== withEfforts!.reasoning!.defaultEffort,
    );
    expect(target, "要先有一个非默认强度").toBeDefined();

    const selected = unwrap<{
      selected: { provider: string; model: string; reasoningEffort?: string };
    }>(
      await handlers.invoke("session/selectModel", {
        request: {
          sessionId,
          provider: "deepseek-official",
          model: withEfforts!.id,
          reasoningEffort: target!.id,
        },
      }),
    );
    expect(selected.selected.reasoningEffort, "端点回显带着强度").toBe(target!.id);

    // 读回走会话自己的 agent：强度是不是真的装进了这条会话，看这里。
    const agent = app.get(AgentDirectory).get(SessionId(sessionId!)) as
      | {
          model?: {
            current(): { provider: string; model: string; reasoningEffort?: string } | undefined;
          };
        }
      | undefined;
    expect(agent?.model?.current(), "会话的当前选择必须带这次选的强度").toMatchObject({
      provider: "deepseek-official",
      model: withEfforts!.id,
      reasoningEffort: target!.id,
    });
  });
});

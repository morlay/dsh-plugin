// 探针：装配一次真实 desktop profile（用宿主同一份 overlay），回答**桌面档的三条事实**——
// 静态断言与包内测试都看不见的那几条。
//
// 判据：
//
// 1. **装配健康**：启用行里没有停在 `pending`（waiting / did not activate）或 `failed`（broken）的；
// 2. **账号/登录面不在**：账号那几个模块（DeepSeek 登录、它的事务面、它的模型路由、它的 client 面）
// 既不激活、也不在页面拿到的 client 名册里；`ui-settings-account` 这个 settings namespace 也不在；
// 3. **模型路径还在**：`credentials` 在场，`llm-pi-ai` 的 `ollama` provider 用 `apiKeyEnv: OLLAMA_API_KEY`
// 引用凭据，且该引用真能解析出启动环境里的值（不真发请求）；`ollama` 路由已注册且有模型。
//
// 页面名册那一项走**生产同一条路**：`takeOverDesktopAuthentication` + `installDesktopTransport` 之后
// 用 `webServer.dispatch()` 取 index HTML（桌面宿主把字节管道的请求原样喂给同一个 `dispatch`）。
//
// 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
//
// ```sh
// pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-desktop-account-plane.mts
// ```
//
// 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
// `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不建会话。
// 环境里会临时放一个 `OLLAMA_API_KEY`（**进程内**，不落盘），用来证明凭据解析路径通了。

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLayeredEnv,
  loadProfileDirectory,
  reportSkippedBundles,
} from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const store = join(repoRoot, "apps/dsh-custom-next/.dsh-store");
const profileDir = join(store, "profiles", "web");
const installAnchor = join(repoRoot, "vendor/deepseek-harness/apps/cli/package.json");
const DESKTOP_PATCH = fileURLToPath(new URL("../config/desktop.cordis.patch.yml", import.meta.url));

// 凭据解析探针用的临时值（只进进程环境，不写任何 store）。
const PROBE_API_KEY = "probe-ollama-api-key";

// 桌面档不该有的账号/登录面：登录实现、它的事务面、它的模型路由、它的 client 面。
const ACCOUNT_MODULES = [
  "@deepseek-ai/dsh-deepseek-account-platform",
  "@deepseek-ai/dsh-api-account-controller",
  "@deepseek-ai/dsh-llm-deepseek-account",
  "@deepseek-ai/dsh-client-ui-settings-account",
];

// 桌面档必须还在的：设置面（模型页承载 API key 路径）与我们的模型路由。
const REQUIRED_CLIENT_MODULES = [
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-models",
];

// cordis `FiberState` 是跨包 const enum，运行期被擦除——按数值镜像（与上游 plugin-inventory 同口径）。
const FIBER_PHASE: Record<number, string> = {
  0: "pending",
  1: "loading",
  2: "active",
  3: "failed",
  4: "disposed",
  5: "unloading",
};

// 账号面的行 id 与 settings namespace（登录进度就存在后者里）。
const ACCOUNT_SETTINGS_NAMESPACE = "ui-settings-account";

interface LoaderEntryLike {
  readonly id: string;
  readonly options: {
    readonly name?: unknown;
    readonly disabled?: unknown;
    readonly group?: unknown;
  };
  readonly fiber?: { readonly state: number };
}

interface Row {
  readonly id: string;
  readonly module: string;
  readonly disabled: boolean;
  readonly phase: string;
}

const profileReady = await access(join(profileDir, "package.json")).then(
  () => true,
  () => false,
);
if (!profileReady) {
  console.error(
    `verify-desktop-account-plane: 没有可用的 profile（${profileDir}）——先跑一次 ` +
      "`just custom dev --web` 或 `just custom desktop` 让 desktopify 准备好它",
  );
  process.exit(2);
}

process.env.DSH_HOME = store;
process.env.OLLAMA_API_KEY = PROBE_API_KEY;

const profile = loadProfileDirectory("dsh", profileDir, installAnchor);
reportSkippedBundles("dsh", profile);

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "desktop",
  resolvedProfile: { profile, installAnchor },
  patchFiles: [DESKTOP_PATCH],
  args: ["--no-open"],
});

// 生产路径上的两件事，探针照做：认证放行 + 客户端 transport 注入（页面名册与 transport 行都靠后者）。
const transport = await import("../src/transport.ts");
transport.takeOverDesktopAuthentication(ctx);
transport.installDesktopTransport(ctx);

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  console.log(`verify-desktop-account-plane: ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) failures.push(message);
}

function serviceOf(name: string): unknown {
  try {
    return (ctx as unknown as { get(key: string): unknown }).get(name);
  } catch {
    return undefined;
  }
}

function rowsOf(): Row[] {
  const loader = serviceOf("loader") as { entries(): Iterable<LoaderEntryLike> } | undefined;
  if (loader === undefined) throw new Error("loader 服务不在场：探针读不到行清单");
  const rows: Row[] = [];
  for (const entry of loader.entries()) {
    if (entry.options.group === true) continue;
    rows.push({
      id: entry.id,
      module: typeof entry.options.name === "string" ? entry.options.name : "(匿名)",
      // 行上的 `disabled` 已经求值成布尔；`!!js` 表达式留下的只有 true / false。
      disabled: entry.options.disabled === true,
      phase: FIBER_PHASE[entry.fiber?.state ?? -1] ?? "none",
    });
  }
  return rows;
}

const rows = rowsOf();
const enabled = rows.filter((row) => !row.disabled);

// ── 1. 装配健康：启用行都得停在 active ─────────────────────────────────────────────────────────

const counts = new Map<string, number>();
for (const row of enabled) counts.set(row.phase, (counts.get(row.phase) ?? 0) + 1);
console.log(
  `verify-desktop-account-plane: 行清单 — 共 ${String(rows.length)} 行，` +
    `启用 ${String(enabled.length)}、禁用 ${String(rows.length - enabled.length)}；` +
    `启用行的相位 — ${[...counts].map(([phase, n]) => `${phase}=${String(n)}`).join(", ")}`,
);
const unhealthy = enabled.filter((row) =>
  ["pending", "loading", "failed", "unloading"].includes(row.phase),
);
for (const row of unhealthy) {
  console.log(`verify-desktop-account-plane:   · 未激活 ${row.id}（${row.module}）= ${row.phase}`);
}
check(unhealthy.length === 0, "启用行全部 active（没有 waiting / broken）");

// ── 2. 账号/登录面不在 ────────────────────────────────────────────────────────────────────────

for (const module of ACCOUNT_MODULES) {
  const matched = rows.filter((row) => row.module === module);
  const active = matched.filter((row) => !row.disabled && row.phase === "active");
  const state =
    matched.length === 0
      ? "不在行清单里"
      : matched.map((row) => `${row.id}=${row.disabled ? "disabled" : row.phase}`).join(", ");
  console.log(`verify-desktop-account-plane:   · ${module} — ${state}`);
  check(active.length === 0, `${module} 不在桌面档激活（账号面已停）`);
}

const namespaces = (
  serviceOf("settings") as
    | { describe(options?: { redactSecrets?: boolean }): readonly { ns: string }[] }
    | undefined
)?.describe({ redactSecrets: true });
const namespaceNames = (namespaces ?? []).map((entry) => entry.ns);
check(
  !namespaceNames.includes(ACCOUNT_SETTINGS_NAMESPACE),
  `settings namespace ${ACCOUNT_SETTINGS_NAMESPACE}（登录/引导进度）不在桌面档`,
);
check(namespaceNames.includes("llm-pi-ai"), "settings namespace llm-pi-ai（模型路由配置）在桌面档");

// 页面拿到的 client 名册：走生产的 dispatch，而不是直接读 registry。
const webServer = serviceOf("webServer") as
  | { dispatch(request: Request): Promise<Response> }
  | undefined;
if (webServer === undefined) failures.push("webServer 服务不在场：取不到 index HTML");
else {
  const response = await webServer.dispatch(new Request("http://127.0.0.1/"));
  const html = await response.text();
  console.log(
    `verify-desktop-account-plane: index — status=${String(response.status)}，` +
      `HTML ${String(html.length)} 字节`,
  );
  check(response.status === 200, "index 请求 200（transport 注入后页面仍可取）");
  for (const module of REQUIRED_CLIENT_MODULES) {
    check(html.includes(module), `页面名册里有 ${module}`);
  }
  for (const module of ACCOUNT_MODULES.filter((name) =>
    name.startsWith("@deepseek-ai/dsh-client"),
  )) {
    check(!html.includes(module), `页面名册里没有 ${module}（设置页没有账号入口）`);
  }
}

// ── 3. 模型路径还在：credentials → OLLAMA_API_KEY → ollama 路由 ────────────────────────────────

const credentials = serviceOf("credentials") as
  | {
      resolve(ref: unknown): Promise<{ value: string } | undefined>;
      describe(ref: unknown): Promise<{ configured: boolean; source?: string }>;
    }
  | undefined;
check(credentials !== undefined, "credentials 服务在桌面档（apiKeyEnv 靠它解析）");

const piAi = namespaces?.find((entry) => entry.ns === "llm-pi-ai") as
  | { value?: { providers?: Record<string, { apiKeyEnv?: unknown; baseURL?: unknown }> } }
  | undefined;
const apiKeyEnv = piAi?.value?.providers?.ollama?.apiKeyEnv;
console.log(
  `verify-desktop-account-plane: llm-pi-ai.providers.ollama.apiKeyEnv — ${String(apiKeyEnv)}`,
);
check(apiKeyEnv === "OLLAMA_API_KEY", "ollama provider 的 apiKeyEnv 是 OLLAMA_API_KEY");
if (credentials !== undefined && typeof apiKeyEnv === "string") {
  const described = await credentials.describe(apiKeyEnv);
  const resolved = await credentials.resolve(apiKeyEnv);
  console.log(
    `verify-desktop-account-plane: credentials.describe(${apiKeyEnv}) — ` +
      `configured=${String(described.configured)} source=${String(described.source)}；` +
      `resolve → ${resolved === undefined ? "(未命中)" : "(命中，值不回显)"}`,
  );
  check(described.configured, `${apiKeyEnv} 在启动环境里被判为已配置`);
  check(resolved?.value === PROBE_API_KEY, `${apiKeyEnv} 解析出的就是启动环境里的值`);
}

const llm = serviceOf("llm") as
  | {
      listProviders(): readonly { id: string; name: string }[];
      listModels(provider: string): Promise<readonly { id: string }[]>;
    }
  | undefined;
const providerIds = (llm?.listProviders() ?? []).map((provider) => provider.id);
console.log(`verify-desktop-account-plane: llm 路由 — ${providerIds.join(", ") || "(无)"}`);
check(providerIds.includes("ollama"), "ollama 路由已注册");
if (llm !== undefined) {
  for (const provider of providerIds) {
    const models = await llm.listModels(provider);
    console.log(
      `verify-desktop-account-plane:   · 路由 ${provider} 的目录 — ${models.map((m) => m.id).join(", ") || "(空)"}`,
    );
    if (provider === "ollama")
      check(models.length > 0, "ollama 路由有可用模型（配置面的目录，不联网）");
  }
}

console.log(`verify-desktop-account-plane: overlay — ${DESKTOP_PATCH.replace(`${repoRoot}/`, "")}`);

await shutdown.shutdown(failures.length === 0 ? 0 : 1);
for (const failure of failures) console.error(`verify-desktop-account-plane: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);

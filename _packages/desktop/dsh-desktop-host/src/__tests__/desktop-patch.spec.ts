import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const PATCH_PATH = join(
  repoRoot,
  "packages/desktop/dsh-desktop-host/config/desktop.cordis.patch.yml",
);
const BUNDLE_ROOT = join(repoRoot, "vendor/deepseek-harness/packages/bundle");
// 前端服务（`@morlay/dsh-client-modules`）那一行：单独一层，web 形态也要挂（用 `--patch`）。
const DEV_CLIENT_PATCH_PATH = join(
  repoRoot,
  "packages/bundles/web-custom-profile/cordis.patch.yml",
);
const devClientPatch = await readFile(DEV_CLIENT_PATCH_PATH, "utf8");
const UPSTREAM_PATCHES = ["base/cordis.patch.yml", "web-app/cordis.patch.yml"];

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const patch = await readFile(PATCH_PATH, "utf8");

// 停用/配置的目标行 id（顶层 `- id:`，不含 insert 出来的行）。
function disabledIds(text: string): string[] {
  return [...text.matchAll(/^- id: (\S+)\n {2}disabled: true$/gm)].map((match) => match[1]!);
}

function configuredIds(text: string): string[] {
  return [...text.matchAll(/^- id: (\S+)\n {2}config:$/gm)].map((match) => match[1]!);
}

function insertedNames(text: string): string[] {
  const names: string[] = [];
  for (const block of text.split(/^- insert:\s*$/m).slice(1)) {
    names.push(
      ...[...block.matchAll(/^ {4}- id: (\S+)\n {6}name: "([^"]+)"$/gm)].map((m) => m[2]!),
    );
  }
  return names;
}

// 上游 patch 里的 `行 id → 模块名`（本 overlay 只按 id 瞄准，名字留在上游那一份）。
async function upstreamModules(): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  for (const file of UPSTREAM_PATCHES) {
    const text = await readFile(join(BUNDLE_ROOT, file), "utf8");
    for (const match of text.matchAll(/^\s*- id: (\S+)\n\s+name: ['"]([^'"]+)['"]/gm))
      modules.set(match[1]!, match[2]!);
  }
  return modules;
}

const upstream = await upstreamModules();

// 账号面的取舍**不在桌面档**：本部署不含登录，那几条由 profile 档
// [`@morlay/mydsh-profile`](../../../bundles/mydsh-profile/tsdown.config.ts) 停（web 形态也同样受益）。
// 桌面档这里只停"桌面形态"自己的两件事：传输接管（`webserver` → `portless-webserver`）与产品遥测。
//
// 为什么非要分家：应用顺序是 `bundle 层 → overlay`，而桌面 overlay 由宿主追加在 `patchFiles` 末尾
// （`src/index.ts:80`）——排最后、覆盖前面所有层。取舍写在 overlay 里，profile 档的同 id 设置就"改不动"。
// 本部署不要账号 UI：停上游那一行，由 profile 档的空壳行补上它的 settings namespace 注册。
const ACCOUNT_ROWS: Readonly<Record<string, string>> = {
  "ui-settings-account": "@deepseek-ai/dsh-client-ui-settings-account",
};

// 桌面档**必须**停的产品遥测面：两行只在 profile 名为 `desktop` 时激活，靠构建期环境变量
// `DSH_CLIENT_VERSION` 填 `serviceVersion`（必填）；自研壳不传那个变量 → 遥测行配置校验失败、
// 产品分析行 pending，页面启动时那条 watchPolicy 流拿 502。本地桌面部署没有上报对象。
const TELEMETRY_ROWS = {
  "desktop-product-telemetry": "@deepseek-ai/dsh-host-product-telemetry-otel",
  "product-analytics": "@deepseek-ai/dsh-client-product-analytics",
} as const;

// 桌面档**故意不动**的行：它们不是登录面，模型路径靠它们。
const KEPT_ROWS = {
  credentials: "@deepseek-ai/dsh-credentials-local",
  authorization: "@deepseek-ai/dsh-authorization",
  "llm-deepseek": "@deepseek-ai/dsh-llm-deepseek-api-key",
} as const;

describe("桌面 overlay 的停用清单", () => {
  it("瞄准的上游行都存在，且行 id 现在确实指向那个模块", () => {
    for (const [id, module] of [
      ...Object.entries(ACCOUNT_ROWS),
      ...Object.entries(TELEMETRY_ROWS),
      ...Object.entries(KEPT_ROWS),
      ["webserver", "@deepseek-ai/dsh-host-webserver"] as const,
    ]) {
      expect(upstream.get(id), `upstream row ${id} moved or was renamed`).toBe(module);
    }
  });

  it("停用清单是产品遥测 + 账号 UI（后者由 profile 档的空壳行接替）", () => {
    // 停用必须在 overlay：写在 bundle 层会被后来应用的层盖回去（实测），而 overlay 排最后。
    // 停的是"账号 UI"那一行——它同时是 settings namespace 的 owner，所以由 profile 档补一个空壳注册。
    expect(disabledIds(patch).sort()).toEqual(
      ["ui-settings-account", ...Object.keys(TELEMETRY_ROWS)].sort(),
    );
  });

  it("桌面档停的浏览器模块是产品分析与账号 UI", () => {
    const clientModules = [...Object.values(ACCOUNT_ROWS), ...Object.values(TELEMETRY_ROWS)].filter(
      (module) => module.startsWith("@deepseek-ai/dsh-client-"),
    );
    expect(clientModules.sort()).toEqual([
      "@deepseek-ai/dsh-client-product-analytics",
      "@deepseek-ai/dsh-client-ui-settings-account",
    ]);
  });

  it("前端服务那一行单独一层，按包名指到 @morlay/dsh-client-modules", async () => {
    expect(insertedNames(devClientPatch)).toEqual(["@morlay/dsh-client-modules"]);
    const built = join(repoRoot, "packages/client/dsh-client-modules/dist/index.js");
    if (await pathExists(built)) expect((await stat(built)).isFile()).toBe(true);
  });

  it("模型路径那几行没有一起被停", () => {
    for (const id of Object.keys(KEPT_ROWS)) expect(disabledIds(patch)).not.toContain(id);
  });

  it("不再替换 webServer；配 web-runtime 与它的随机端口", () => {
    // 以前这里禁掉 `webserver` 并插一个"无端口替身"（请求走字节管道喂进来）。那条路没有 origin，
    // 基于 URL/WS 的东西（settings 的 describe 流、账号的 stream mux、vite 的 HMR）拿不到答复——
    // 现在照常 listen，壳用它的 origin 载入窗口。
    expect(insertedNames(patch)).toEqual(["../src/settings-namespace.ts"]);
    expect(disabledIds(patch)).not.toContain("webserver");
    expect(configuredIds(patch).sort()).toEqual(["web-runtime", "webserver"]);
    // 插入的那一行是"账号面空壳"：顶替被停掉的 `ui-settings-account` 那个 settings namespace 注册。
    // 端口必须随机：上游 `web-app` 给的是 `webStartup.port ?? 3080`，桌面没有 `--port`，于是落到 3080
    // ——两个实例或本机别的工具占了它，第二次就起不来。
    expect(portOfWebServer(patch)).toBe(0);
  });

  it("停用各归其位：遥测与官方账号实现都在桌面 overlay（写在 bundle 层会被盖回去）", async () => {
    const overlay = await readFile(
      join(repoRoot, "packages/desktop/dsh-desktop-host/config/desktop.cordis.patch.yml"),
      "utf8",
    );
    // 桌面 overlay 只管桌面形态自己那两件：传输接管与产品遥测。
    for (const id of Object.keys(TELEMETRY_ROWS)) {
      expect(overlay, `overlay 该停 ${id}`).toContain(id);
    }
    // 账号实现必须在本 overlay 里（它是最后应用的一层）；写在 profile 档里会被后来应用的层盖回去。
    for (const id of Object.keys(ACCOUNT_ROWS)) {
      expect(overlay, `overlay 该停在 ${id}`).toContain(id);
    }
    const profile = await readFile(
      join(repoRoot, "packages/bundles/mydsh-profile/cordis.patch.yml"),
      "utf8",
    );
    // profile 档不承担停用（写那儿不生效）；它负责的是"空壳注册"。
    expect(profile, "profile 档不该出现停用").not.toContain("disabled: true");
  });
});

/** 桌面 overlay 给 `webserver` 定的端口。 */
function portOfWebServer(source: string): number | undefined {
  const row = source.split("\n- id: ").find((chunk) => chunk.startsWith("webserver"));
  return row === undefined
    ? undefined
    : /port: (\d+)/.exec(row)?.[1] === undefined
      ? undefined
      : Number(/port: (\d+)/.exec(row)?.[1]);
}

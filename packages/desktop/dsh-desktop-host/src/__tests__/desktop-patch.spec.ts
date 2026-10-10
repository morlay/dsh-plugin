import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const PATCH_PATH = join(
  repoRoot,
  "packages/desktop/dsh-desktop-host/config/desktop.cordis.patch.yml",
);
const BUNDLE_ROOT = join(repoRoot, "vendor/deepseek-harness/packages/bundle");
const UPSTREAM_PATCHES = ["base/cordis.patch.yml", "web-app/cordis.patch.yml"];

const patch = await readFile(PATCH_PATH, "utf8");

// 停用/配置的目标行 id（顶层 `- id:`，不含 insert 出来的行）。
function targetedIds(text: string): string[] {
  return [...text.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1]!);
}

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

// 桌面档**必须**停的登录/账号面，以及它停的到底是哪个模块。
const ACCOUNT_ROWS = {
  "deepseek-account": "@deepseek-ai/dsh-deepseek-account-platform",
  "account-controller": "@deepseek-ai/dsh-api-account-controller",
  "llm-deepseek-account": "@deepseek-ai/dsh-llm-deepseek-account",
  "ui-settings-account": "@deepseek-ai/dsh-client-ui-settings-account",
} as const;

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

// 除桌面 overlay 之外的装配层：这些停用只该影响桌面档。
async function otherPatchFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(repoRoot, "packages/bundles"), { withFileTypes: true })) {
    if (entry.isDirectory())
      files.push(join(repoRoot, "packages/bundles", entry.name, "cordis.patch.yml"));
  }
  return files;
}

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

  it("停用清单就是传输接管那一行，加上产品遥测与登录/账号面", () => {
    expect(disabledIds(patch).sort()).toEqual(
      ["webserver", ...Object.keys(TELEMETRY_ROWS), ...Object.keys(ACCOUNT_ROWS)].sort(),
    );
  });

  it("停用的浏览器模块就是账号 client 面与产品分析", () => {
    const clientModules = [...Object.values(ACCOUNT_ROWS), ...Object.values(TELEMETRY_ROWS)].filter(
      (module) => module.startsWith("@deepseek-ai/dsh-client-"),
    );
    expect(clientModules.sort()).toEqual([
      "@deepseek-ai/dsh-client-product-analytics",
      "@deepseek-ai/dsh-client-ui-settings-account",
    ]);
  });

  it("模型路径那几行没有一起被停", () => {
    for (const id of Object.keys(KEPT_ROWS)) expect(disabledIds(patch)).not.toContain(id);
  });

  it("传输接管的两处配置仍在（无端口 webServer + web-runtime 全项）", () => {
    expect(insertedNames(patch)).toEqual(["../lib/webserver.js", "../lib/dev-client-bundles.js"]);
    expect(configuredIds(patch)).toEqual(["web-runtime"]);
    expect(targetedIds(patch)).toContain("web-runtime");
  });

  it("这些停用只在桌面 overlay 里出现（bundles 与 profile 层不受影响）", async () => {
    const rows = [...Object.entries(ACCOUNT_ROWS), ...Object.entries(TELEMETRY_ROWS)];
    for (const file of await otherPatchFiles()) {
      const text = await readFile(file, "utf8");
      for (const [id, module] of rows) {
        expect(text, `${file} mentions ${id}`).not.toContain(id);
        expect(text, `${file} mentions ${module}`).not.toContain(module);
      }
    }
  });
});

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

/** 停用/配置的目标行 id（顶层 `- id:`，不含 insert 出来的行）。 */
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
  const block = text.split(/^- insert:\s*$/m)[1];
  if (block === undefined) return [];
  return [...block.matchAll(/^ {4}- id: (\S+)\n {6}name: "([^"]+)"$/gm)].map((match) => match[2]!);
}

/** 上游 patch 里的 `行 id → 模块名`（本 overlay 只按 id 瞄准，名字留在上游那一份）。 */
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

/** 桌面档**必须**停的登录/账号面，以及它停的到底是哪个模块。 */
const ACCOUNT_ROWS = {
  "deepseek-account": "@deepseek-ai/dsh-deepseek-account-platform",
  "account-controller": "@deepseek-ai/dsh-api-account-controller",
  "llm-deepseek-account": "@deepseek-ai/dsh-llm-deepseek-account",
  "ui-settings-account": "@deepseek-ai/dsh-client-ui-settings-account",
} as const;

/** 桌面档**故意不动**的行：它们不是登录面，模型路径靠它们。 */
const KEPT_ROWS = {
  credentials: "@deepseek-ai/dsh-credentials-local",
  authorization: "@deepseek-ai/dsh-authorization",
  "llm-deepseek": "@deepseek-ai/dsh-llm-deepseek-api-key",
} as const;

/** 除桌面 overlay 之外的装配层：账号面不该在这些地方被停（决定只影响桌面档）。 */
async function otherPatchFiles(): Promise<string[]> {
  const files: string[] = [join(repoRoot, "apps/dsh-custom-next/cordis.patch.yml")];
  for (const entry of await readdir(join(repoRoot, "packages/bundles"), { withFileTypes: true })) {
    if (entry.isDirectory())
      files.push(join(repoRoot, "packages/bundles", entry.name, "cordis.patch.yml"));
  }
  return files;
}

describe("桌面 overlay 的账号面停用", () => {
  it("瞄准的上游行都存在，且行 id 现在确实指向那个模块", () => {
    for (const [id, module] of [
      ...Object.entries(ACCOUNT_ROWS),
      ...Object.entries(KEPT_ROWS),
      ["webserver", "@deepseek-ai/dsh-host-webserver"] as const,
    ]) {
      expect(upstream.get(id), `upstream row ${id} moved or was renamed`).toBe(module);
    }
  });

  it("停用清单就是登录/账号面加上传输接管那一行", () => {
    expect(disabledIds(patch).sort()).toEqual(["webserver", ...Object.keys(ACCOUNT_ROWS)].sort());
  });

  it("账号的 client 面是停用行里唯一的浏览器模块（设置页账号页随它消失）", () => {
    const clientModules = Object.values(ACCOUNT_ROWS).filter((module) =>
      module.startsWith("@deepseek-ai/dsh-client-"),
    );
    expect(clientModules).toEqual(["@deepseek-ai/dsh-client-ui-settings-account"]);
  });

  it("模型路径那几行没有一起被停", () => {
    for (const id of Object.keys(KEPT_ROWS)) expect(disabledIds(patch)).not.toContain(id);
  });

  it("传输接管的两处配置仍在（无端口 webServer + web-runtime 全项）", () => {
    expect(insertedNames(patch)).toEqual(["../lib/webserver.js"]);
    expect(configuredIds(patch)).toEqual(["web-runtime"]);
    expect(targetedIds(patch)).toContain("web-runtime");
  });

  it("账号面只在桌面 overlay 里被提到（bundles 与 profile 层不受影响）", async () => {
    for (const file of await otherPatchFiles()) {
      const text = await readFile(file, "utf8");
      for (const [id, module] of Object.entries(ACCOUNT_ROWS)) {
        expect(text, `${file} mentions ${id}`).not.toContain(id);
        expect(text, `${file} mentions ${module}`).not.toContain(module);
      }
    }
  });
});

// client 行清单：从**入口 Module 展开后的装配面**推导——每个 Provider 定义文件所属包若是 bundle
// （`dsh.bundle.patch`），把它的 patch 行名（上游包）里**有 client 半**的挑出来；
// 具体入口由 `client-modules` 按 `exports["./client"]` / 约定路径解析。
// 全程异步 IO（启动链上不阻塞事件循环）。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { moduleFileOf, moduleImportsOf, providersOfModule, type ModuleClass } from "@morlay/zephyr";

interface Manifest {
  name?: string;
  exports?: Record<string, unknown>;
  dsh?: { client?: unknown; bundle?: { patch?: string | readonly string[] } };
}

async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

async function packageDirOf(file: string): Promise<string | undefined> {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if ((await readManifest(dir)) !== undefined) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

async function patchFilesOf(dir: string, manifest: Manifest): Promise<string[]> {
  const patch = manifest.dsh?.bundle?.patch;
  if (patch === undefined) return [join(dir, "cordis.patch.yml")];
  const files = typeof patch === "string" ? [patch] : [...patch];
  return files.map((file) => join(dir, file));
}

export interface ClientRowsOptions {
}

/** 入口 Module 展开后能看到的 bundle 的 patch 行里，有 client 半的包名（按装配顺序去重）。 */
export async function clientPackagesOf(
  module: ModuleClass,
  _options: ClientRowsOptions = {},
): Promise<readonly string[]> {
  const names: string[] = [];
  const seen = new Set<string>();

  // bundle 可能只有 imports/without、没有自己的 Provider（如 `web-custom-profile`）：先把 Module 树里
  // 出现过的**所有 Module 定义文件**所属包都当成候选，再看它是不是 bundle。
  const files: string[] = [];
  // bundle 自己声明的「随 host 关闭的 client 行」。
  const excluded = new Set<string>();
  const collectModules = (current: ModuleClass): void => {
    const file = moduleFileOf(current);
    if (file !== undefined) files.push(file);
    for (const name of (current as { clientExclude?: readonly string[] }).clientExclude ?? []) {
      excluded.add(name);
    }
    for (const imported of moduleImportsOf(current)) collectModules(imported);
  };
  collectModules(module);
  for (const entry of providersOfModule(module)) {
    const file = (entry as { providerFile?: string }).providerFile;
    if (file !== undefined) files.push(file);
  }

  // 先收「被禁用」的行 id：`without(...)` 落成 patch 的 disabled 行，对应的 client 半也不能装
  // （典型：`client-hmr` 被停用后，浏览器端仍去连 `/plugins/events`，就是无限 `connection lost`）。
  const disabledIds = new Set<string>();
  for (const file of files) {
    const dir = await packageDirOf(file);
    if (dir === undefined) continue;
    const manifest = await readManifest(dir);
    if (manifest?.dsh?.bundle === undefined) continue;
    for (const path of await patchFilesOf(dir, manifest)) {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        continue;
      }
      for (const match of text.matchAll(/^- id: (\S+)\n {2}disabled: true$/gm)) {
        disabledIds.add(match[1]!);
      }
    }
  }

  // 适配类所在的**上游包**自己带 client 半（host / client 同包，如 `@deepseek-ai/dsh-client-connection`）：
  // 这类 client 行不是我们 patch 里的 `name:`，只按 patch 行推导会漏掉它（`remote` 服务就没人提供）。
  for (const file of files) {
    const dir = await packageDirOf(file);
    if (dir === undefined) continue;
    const manifest = await readManifest(dir);
    const name = manifest?.name;
    if (name === undefined || (manifest?.exports?.["./client-module"] === undefined && manifest?.exports?.["./client"] === undefined)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  // 浏览器只装载**我们自己的** client 行：上游 client 插件由这些行内部 `fromCordis` 包装（见
  // `dsh-web-app/src/web-app.client.module.ts`）。清单里出现 `@deepseek-ai/*` 就等于「全局引入上游」，
  // 上游换实现时清单也要跟着改——这条是红线。
  for (const file of files) {
    const dir = await packageDirOf(file);
    if (dir === undefined) continue;
    const manifest = await readManifest(dir);
    const name = manifest?.name;
    if (name === undefined || name.startsWith("@deepseek-ai/")) continue;
    if (seen.has(name)) continue;
    const byExports =
      manifest?.exports?.["./client-module"] !== undefined || manifest?.exports?.["./client"] !== undefined;
    const conventional = await readFile(join(dir, "src/client/index.ts"), "utf8").then(
      () => true,
      () => false,
    );
    if (!byExports && !conventional) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

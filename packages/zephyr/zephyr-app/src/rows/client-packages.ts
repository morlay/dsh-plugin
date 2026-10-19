// client 行清单：从**入口的 provider 清单**推导——每个 Provider 的定义文件所属包若是 bundle
// （`dsh.bundle.patch`），把它的 patch 行名里**有 client 半**的挑出来；
// 具体入口由 `client-modules` 按 `exports["./client-module"]`（我们的约定）解析。
// 全程异步 IO（启动链上不阻塞事件循环）。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderEntry } from "@morlay/zephyr";

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
  /** 随 host 关闭的 client 行（过去是 bundle 类上的 `static clientExclude`）：装配方显式给。 */
  readonly exclude?: readonly string[];
}

/**
 * 入口清单里能看到的 bundle 的 patch 行中，有 client 半的包名（按装配顺序去重）。
 *
 * 依赖的是 `ProviderEntry` 这个既有抽象（每条实现由 `@Injectable()` 记下自己的定义文件），
 * 不是某个装配容器：`configure` 绑过配置的条目经 `providerBase` 回溯到实现类再取文件。
 * @param providers - 入口的 provider 清单（已摊平，`provide(...)` 的返回值）。
 * @param options - `exclude`：不随 host 关闭的 client 行。
 * @returns 包名清单。
 */
export async function clientPackagesOf(
  providers: readonly ProviderEntry[],
  options: ClientRowsOptions = {},
): Promise<readonly string[]> {
  const names: string[] = [];
  const seen = new Set<string>();

  const files: string[] = [];
  const excluded = new Set<string>(options.exclude ?? []);
  for (const entry of providers) {
    // 绑过配置的条目：身份在 `providerBase` 上（定义文件也记在实现类上）。
    const base = (entry as { providerBase?: Function }).providerBase ?? entry;
    const file = (base as { providerFile?: string }).providerFile;
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
    if (name === undefined || (manifest?.exports?.["./client-module"] === undefined)) continue;
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

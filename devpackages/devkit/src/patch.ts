/**
 * bundle patch：**一份真源**（`rows()`）渲染成包根那份 `cordis.patch.yml`，构建期由 tsdown 插件重写。
 *
 * 装配入口的包（`bundles/*`）形态都一样，所以这段代码住在这里：行清单直接写在各自的
 * `tsdown.config.ts` 里，插件在 build 时把它渲染到包根。
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import type { Plugin } from "rolldown";

/**
 * 一个 bundle 的 patch 真源。
 */
export interface PatchBundleOptions {
  /** 真源在仓库里的路径（写进生成物的头注释，便于反查）。 */
  readonly source: string;
  /** 真源的 `import.meta.url`：生成物按 {@link PatchBundleOptions.file} 落位（缺省与真源同目录）。 */
  readonly from: string;
  /** 生成物相对 `from` 所在目录的路径，默认 `cordis.patch.yml`。真源在 `tool/` 里时写 `../cordis.patch.yml`。 */
  readonly file?: string;
  /** patch 行清单（延迟求值：构建与测试读同一份）。 */
  readonly rows: () => readonly unknown[];
}

/** 生成物的绝对路径：相对真源所在目录。 */
export function patchFileOf(options: PatchBundleOptions): string {
  return resolve(dirname(fileURLToPath(options.from)), options.file ?? "cordis.patch.yml");
}

/** 渲染生成物文本：头注释 + YAML。 */
export function renderPatch(options: PatchBundleOptions): string {
  const header = `# 本文件由 ${options.source} 生成，请勿手工编辑\n`;
  const body = yaml.dump([...options.rows()], {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${header}${body}`;
}

/** 写出生成物（本地生成与测试用；构建里由 {@link bundlePatch} 调用）。 */
export async function generatePatch(options: PatchBundleOptions): Promise<string> {
  const path = patchFileOf(options);
  await writeFile(path, renderPatch(options));
  return path;
}

/**
 * tsdown / rolldown 插件：产物落盘后重写包根那份 `cordis.patch.yml`。
 *
 * 用 `writeBundle` 而不是更早的钩子：生成物是**入库产物**，与 `dist` 同一轮落盘最不容易漏。
 * @param options - 真源与生成物位置。
 */
export function bundlePatch(options: PatchBundleOptions): Plugin {
  return {
    name: "devkit:bundle-patch",
    async writeBundle() {
      process.stdout.write(`generated ${await generatePatch(options)}\n`);
    },
  };
}

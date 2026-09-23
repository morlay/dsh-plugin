import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { TOOLKIT_ROWS } from "../src/rows.ts";

/**
 * bundle patch 的真源：把 {@link TOOLKIT_ROWS}（`src/rows.ts` 那一份清单）插到 host 平面。
 *
 * 这是"直接装配"那种采用方式：`dsh.profile.bundles` 列出本包时，功能行对所有 preset 生效（官方
 * standard / ptc / minimal / cordis 一样看得见这些工具）。要"只有某个模式才有"，就让那个 preset 引用
 * `rows` 出口里的清单，别同时用两种。
 */

export const PATCH_ROWS: readonly Record<string, unknown>[] = [{ insert: [...TOOLKIT_ROWS] }];

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/profile/dsh-agent-toolkit/tool/patch.ts 生成，请勿手工编辑
`;

export function renderPatch(): string {
  const body = yaml.dump([...PATCH_ROWS], {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${HEADER}${body}`;
}

/** 把 bundle patch 落到包根：它是发布产物的一部分（`files` 里有它，装配按出口解析）。 */
export async function generatePatch(): Promise<string> {
  const path = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), PATCH_FILE);
  await writeFile(path, renderPatch());
  return path;
}

/** tsdown 的 `build:done` 钩子：每次构建重写 `cordis.patch.yml`。 */
export function patchHooks(): { "build:done": () => Promise<void> } {
  return {
    "build:done": async () => {
      process.stdout.write(`generated ${await generatePatch()}\n`);
    },
  };
}

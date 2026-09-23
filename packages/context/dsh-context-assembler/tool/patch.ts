import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { PATCH_ROWS } from "../src/rows.ts";

/**
 * bundle patch 的真源：把 {@link PATCH_ROWS}（`src/rows.ts` 那一份清单）写成 `cordis.patch.yml`。
 *
 * 本包有两种采用方式（见 `src/rows.ts`）：`dsh.profile.bundles` 直接列出本包时用这份 patch；由
 * preset 引用时走 preset 自己的行清单——**同一份真源**，不会两边漂移。
 */

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/context/dsh-context-assembler/tool/patch.ts 生成，请勿手工编辑
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

/** tsdown 的 `build:done` 钩子：每次构建重写 `cordis.patch.yml`，入库的那份因此永远等于 `PATCH_ROWS`。 */
export function patchHooks(): { "build:done": () => Promise<void> } {
  return {
    "build:done": async () => {
      process.stdout.write(`generated ${await generatePatch()}\n`);
    },
  };
}

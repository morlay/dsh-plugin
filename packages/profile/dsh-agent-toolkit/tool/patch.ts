import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { TOOLKIT_EXTRA_ROWS, TOOLKIT_ROWS } from "../src/rows.ts";

/**
 * bundle patch 的真源：把 {@link TOOLKIT_ROWS}（`src/rows.ts` 那一份清单，按工具族分组）与
 * {@link TOOLKIT_EXTRA_ROWS}（压缩与工具说明那两行，不属于任何族）插到 host 平面。
 *
 * `dsh.profile.bundles` 列出本包时，功能行在 profile 平面**装一次**——模式之间用什么工具，由
 * [`@morlay/dsh-session-mode`](../../dsh-session-mode/README.md) 的 `allowTools` 收口（名单由
 * `TOOLKIT_TOOL_NAMES` 从汉化的族数据派生），所以这里不按模式分叉。
 */

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    insert: [
      // 工具行：整套按族分组（chat 也装着，靠模式的 `allowTools` 收口）。
      ...TOOLKIT_ROWS,
      // 工具说明（描述汉化 + schema 精简 + 用法分组）与压缩引擎行。
      ...TOOLKIT_EXTRA_ROWS,
    ],
  },
];

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

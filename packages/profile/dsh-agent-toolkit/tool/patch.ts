import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { agentTeamRows } from "../src/agent-team.ts";
import { TOOLKIT_ROWS } from "../src/rows.ts";

/**
 * bundle patch 的真源：把 {@link TOOLKIT_ROWS}（`src/rows.ts` 那一份清单）插到 host 平面。
 *
 * 这是"直接装配"那种采用方式：`dsh.profile.bundles` 列出本包时，功能行对所有 preset 生效（官方
 * standard / ptc / minimal / cordis 一样看得见这些工具）。要"只有某个模式才有"，就让那个 preset 引用
 * `rows` 出口里的清单，别同时用两种。
 */

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    insert: [
      // 工具行：整套（chat 也装着，靠模式的 `allowTools` 收口）。
      ...TOOLKIT_ROWS,
      // 工具说明：描述汉化 + schema 精简 + 用法分组（注册给通道，通道也在 profile 平面）。
      { id: "tool-guidance", name: "@morlay/dsh-agent-toolkit/guidance" },
      // Agent Teams：默认关闭的组（`DSH_AGENT_TEAM=1` 才装），与直接派发行互斥。
      ...agentTeamRows(),
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

import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { PRESET_SOURCES, type PresetSource } from "./presets/index.ts";

/**
 * bundle patch 的行清单：**只有模式注册**。
 *
 * 一个 preset 就是一行的 `config.plugins`（上游 `@deepseek-ai/dsh-agent-preset` 的声明式形态）：
 * 注册表不扫目录、不收路径，所以自定义模式只能以行出现在这份 patch 里。
 *
 * 默认模式（`agent-preset-registry` 的 `default`）也在这里：它是"注册了什么模式"的一半事实，
 * 与模式清单同一个 home。host 层的部署配置（llm route、搜索后端、沙箱）在 `@morlay/dsh-profile`。
 *
 * 这里是生成物的真源：`cordis.patch.yml` 由 `renderPatch()` 写出，改动请改这份 TS，
 * 一致性由 `patch.spec.ts` 的断言兜住。
 */

function presetRow(source: PresetSource): Record<string, unknown> {
  return {
    id: `preset-${source.id}`,
    name: "@deepseek-ai/dsh-agent-preset",
    config: {
      id: source.id,
      name: source.name,
      description: source.description,
      order: source.order,
      plugins: [...source.rows],
    },
  };
}

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    // 注册表只认 `default`：模式定义是下面那批 preset 行，它自己既不扫描也不收路径。
    // 官方那四个 shipped preset 行（standard / ptc / minimal / cordis）**不动**：它们是各自 scope 里的
    // 完整 composition，与我们的模式并存、可选；default 仍指向我们的第一个模式。
    id: "agent-preset-registry",
    config: { default: PRESET_SOURCES[0]!.id },
  },
  {
    insert: PRESET_SOURCES.map(presetRow),
  },
];

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/profile/dsh-agent-preset/tool/patch.ts 生成，请勿手工编辑
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

/**
 * tsdown 的 `build:done` 钩子：每次构建重写 `cordis.patch.yml`，入库的那份因此永远等于
 * `PATCH_ROWS`（`patch.spec.ts` 比对文件与 `renderPatch()`）。
 */
export function patchHooks(): { "build:done": () => Promise<void> } {
  return {
    "build:done": async () => {
      process.stdout.write(`generated ${await generatePatch()}\n`);
    },
  };
}

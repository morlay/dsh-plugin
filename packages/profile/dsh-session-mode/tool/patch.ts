import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { scopeRow } from "@morlay/dsh-context-assembler/rows";
import yaml from "js-yaml";
import { DEFAULT_MODE, MODE_MODELS, MODE_SOURCES, type ModeSource } from "./modes.ts";

/**
 * bundle patch 的行清单：**两行**——模式本身，与模式的工具收口。
 *
 * | 行                        | 是什么                                                                                     |
 * | ------------------------- | ------------------------------------------------------------------------------------------ |
 * | `session-mode`            | 模式清单、默认模式与各模式的默认模型（`config.modes` / `config.default` / `config.models`）+ 按会话应用 persona + 页面用的路由 |
 * | `context-assembler-scope` | `@morlay/dsh-context-assembler/scope`：读模式定义，按会话收口工具、instruction 与动态快照    |
 *
 * 工具行与注入通道**都不在这里**——它们由各自的 bundle 在 profile 平面装一次
 * （`dsh.profile.bundles` 里的 [`@morlay/dsh-agent-toolkit`](../dsh-agent-toolkit/README.md) 与
 * [`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md)）。模式只声明"我要哪些"。
 *
 * 这里是生成物的真源：`cordis.patch.yml` 由 `renderPatch()` 写出，改动请改这份 TS，
 * 一致性由 `patch.spec.ts` 的断言兜住。
 */

function modeConfig(source: ModeSource): Record<string, unknown> {
  return {
    name: source.name,
    description: source.description,
    ...(source.role === undefined ? {} : { role: [...source.role] }),
    ...(source.persona === undefined ? {} : { persona: { ...source.persona } }),
    allowTools: [...source.allowTools],
    ...(source.instructions === undefined ? {} : { instructions: source.instructions }),
    ...(source.runtimeContext === undefined ? {} : { runtimeContext: source.runtimeContext }),
  };
}

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    insert: [
      {
        id: "session-mode",
        name: "@morlay/dsh-session-mode",
        config: {
          default: DEFAULT_MODE,
          modes: Object.fromEntries(MODE_SOURCES.map((source) => [source.id, modeConfig(source)])),
          // 各模式的默认模型（volatile：设置页那张卡片写的就是这个路径）。当前没有配任何一条，
          // 仍显式渲染成空对象——这份 patch 是装配层的真源，字段在不在要看得见。
          models: Object.fromEntries(
            Object.entries(MODE_MODELS).map(([id, model]) => [id, { ...model }]),
          ),
        },
      },
      // 行 id 与 name 的真源在 `@morlay/dsh-context-assembler/rows` 的 `scopeRow()`：模式的收口是那个包的
      // 出口，这里只是把它装进装配（与模式定义同一份 patch，行序上服务在前）。
      scopeRow(),
    ],
  },
];

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/profile/dsh-session-mode/tool/patch.ts 生成，请勿手工编辑
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

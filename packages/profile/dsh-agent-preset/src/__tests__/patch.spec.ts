import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { renderPatch } from "../../tool/patch.ts";
import { PRESET_SOURCES } from "../../tool/presets/index.ts";

const PATCH_PATH = join(process.cwd(), "packages/profile/dsh-agent-preset/cordis.patch.yml");

interface PluginRow {
  id?: string;
  name?: string;
  isolate?: Record<string, unknown>;
  /** `!!js` 表达式（Loader 激活时求值）：这里是运行期开关的判据。 */
  disabled?: boolean | { __jsExpr: string };
  config?: Record<string, unknown> | PluginRow[];
}

interface PatchRow {
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  insert?: PatchRow[];
}

async function loadPatchRows(path: string): Promise<PatchRow[]> {
  return yaml.load(await readFile(path, "utf8"), { schema: entryListSchema }) as PatchRow[];
}

const rows = await loadPatchRows(PATCH_PATH);
const inserted = rows.flatMap((row) => row.insert ?? []);

function presetRow(id: string): PatchRow | undefined {
  return inserted.find((row) => row.id === `preset-${id}`);
}

function pluginsOf(id: string): PluginRow[] {
  return (presetRow(id)?.config?.["plugins"] ?? []) as PluginRow[];
}

describe("dsh-agent-preset patch wiring", () => {
  it("仓库里那份带上了该有的装配（它是运行期各形态都要的文件，不能只靠 build 产出）", async () => {
    const shape = (list: PatchRow[]) => ({
      ids: list.map((row) => row.id ?? "(insert)"),
      inserted: list.flatMap((row) => row.insert ?? []).map((row) => row.id),
    });

    // 与生成结果同一形状：改了 tool/patch.ts 忘了重新生成、或手改了这个文件，这里会红。
    expect(shape(rows)).toEqual(
      shape(yaml.load(renderPatch(), { schema: entryListSchema }) as PatchRow[]),
    );
    expect(shape(rows).inserted).toEqual(PRESET_SOURCES.map((source) => `preset-${source.id}`));
    expect(
      renderPatch().startsWith("# 本文件由 packages/profile/dsh-agent-preset/tool/patch.ts"),
    ).toBe(true);
  });

  it("preset 就是一行 `@deepseek-ai/dsh-agent-preset`，config 逐项等于清单", () => {
    // 注册表不扫目录、不收路径：我们的模式只能以行的形态出现在这份 patch 里。
    for (const source of PRESET_SOURCES) {
      const row = presetRow(source.id);

      expect(row?.name).toBe("@deepseek-ai/dsh-agent-preset");
      expect(row?.config).toEqual({
        id: source.id,
        name: source.name,
        description: source.description,
        order: source.order,
        // `!!js` 往返后仍是表达式节点，所以清单与产物逐字对得上。
        plugins: JSON.parse(JSON.stringify(source.rows)) as unknown,
      });
    }
    // 没有第三个模式被顺手带上：清单就是全部。
    expect(inserted.filter((row) => row.name === "@deepseek-ai/dsh-agent-preset")).toHaveLength(
      PRESET_SOURCES.length,
    );
  });

  it("注册表的默认模式取自清单的首项", () => {
    expect(rows.find((row) => row.id === "agent-preset-registry")?.config).toEqual({
      default: PRESET_SOURCES[0]!.id,
    });
  });

  it("「先读后改」的放宽行只装在 coding 模式里", () => {
    // 上游那层策略对所有会话生效（它住 host 层），按模式关掉只能由该模式自己抢在它的 waterfall
    // 前面——所以这一行是模式装配的一部分，不是 host 开关（preset 里的行动不了 host 行）。
    const names = (id: string): (string | undefined)[] =>
      pluginsOf(id).map((row) => (typeof row.name === "string" ? row.name : undefined));

    expect(names("coding")).toContain("@morlay/dsh-agent-preset/relax-intent");
    expect(names("chat")).not.toContain("@morlay/dsh-agent-preset/relax-intent");
  });

  it("每个模式只有提示词与开关：工具行与注入通道都不在这里", () => {
    // 工具行（含 Agent Teams 那组）与通道都在 profile 平面装一次（`dsh.profile.bundles` 里的
    // `@morlay/dsh-agent-toolkit` / `@morlay/dsh-context-assembler`）；模式只声明"我要哪些"。
    for (const source of PRESET_SOURCES) {
      const plugins = pluginsOf(source.id);
      const ids = plugins.map((row) => row.id);

      expect(ids, `${source.id}: 提示词`).toContain("persona");
      expect(ids, `${source.id}: 开关`).toContain("context-scope");
      // 工具 / 命令 / 压缩 / 委派 / 技能这些行都来自 toolkit（profile 平面），模式里一行都没有。
      for (const toolRow of [
        "tool-bash",
        "tool-pwsh",
        "tool-fs",
        "skill-filesystem",
        "command-goal",
        "compaction",
        "delegation",
        "tool-subagent",
        "tool-web",
      ]) {
        expect(ids, `${source.id}: ${toolRow}`).not.toContain(toolRow);
      }
      expect(ids, `${source.id}: 通道组`).not.toContain("context-assembler-channel");
      expect(ids, `${source.id}: 工具说明行`).not.toContain("tool-guidance");
      expect(
        plugins.filter((row) => row.isolate?.["contextAssembler"] !== undefined),
        `${source.id}: isolate 组`,
      ).toEqual([]);
    }
  });

  it("开关按模式给：coding 列全套工具，chat 收成三件并关掉 instruction 与动态快照", () => {
    const scopeConfig = (id: string): Record<string, unknown> | undefined =>
      pluginsOf(id).find((row) => row.id === "context-scope")?.config as
        | Record<string, unknown>
        | undefined;

    const allowTools = scopeConfig("coding")?.["allowTools"] as string[] | undefined;

    // 名单与工具集同源（从 toolkit 的汉化数据派生），这里挑几个代表性工具核对。
    expect(allowTools).toContain("read");
    expect(allowTools).toContain("bash");
    expect(allowTools).toContain("subagent");
    expect(allowTools).toContain("present");

    const chat = scopeConfig("chat");
    expect(chat?.["allowTools"]).toEqual(["ask_user_question", "web_search", "web_fetch"]);
    expect(chat?.["instructions"]).toBe(false);
    expect(chat?.["runtimeContext"]).toBe(false);
  });

  it("Agent Teams 由 toolkit 的 bundle 管（模式里没有它）", () => {
    for (const source of PRESET_SOURCES) {
      expect(pluginsOf(source.id).map((row) => row.id)).not.toContain("agent-team");
    }
  });
});

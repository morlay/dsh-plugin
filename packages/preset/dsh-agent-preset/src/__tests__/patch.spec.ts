import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { renderPatch } from "../../tool/patch.ts";
import { PRESET_SOURCES } from "../../tool/presets/index.ts";

const PATCH_PATH = join(process.cwd(), "packages/preset/dsh-agent-preset/cordis.patch.yml");

interface PluginRow {
  id?: string;
  name?: string;
  isolate?: Record<string, unknown>;
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
      renderPatch().startsWith("# 本文件由 packages/preset/dsh-agent-preset/tool/patch.ts"),
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
    // 上游那层策略对所有 preset 生效（它住 host 层），按模式关掉只能由该模式自己抢在它的 waterfall
    // 前面——所以这一行是模式装配的一部分，不是 host 开关（preset 里的行动不了 host 行）。
    const names = (id: string): (string | undefined)[] =>
      pluginsOf(id).map((row) => (typeof row.name === "string" ? row.name : undefined));

    expect(names("coding")).toContain("@morlay/dsh-agent-preset/relax-intent");
    expect(names("chat")).not.toContain("@morlay/dsh-agent-preset/relax-intent");
  });

  it("每个模式里的注入行都在同一个 isolate 组里，与通道同子树", () => {
    // 这是本轮的核心契约：通道发布 `ctx.contextAssembler`，只有组内的行解析得到它；反过来，
    // 任何留在组外的 @morlay/dsh-context-* 行都会在 root realm 里找不到通道，或拿到别人的实现。
    for (const source of PRESET_SOURCES) {
      const plugins = pluginsOf(source.id);
      const groups = plugins.filter((row) => row.isolate?.["contextAssembler"] !== undefined);

      expect(groups, `${source.id}: 通道组`).toHaveLength(1);
      const [channel] = groups;
      expect(channel?.name).toBe("cordis:group");

      const members = (channel?.config ?? []) as PluginRow[];
      expect(members.map((row) => row.id)).toContain("context-assembler");

      const outside = plugins.filter(
        (row) =>
          row !== channel &&
          typeof row.name === "string" &&
          row.name.startsWith("@morlay/dsh-context/"),
      );

      expect(outside, `${source.id}: 组外的注入行`).toEqual([]);
    }
  });
});

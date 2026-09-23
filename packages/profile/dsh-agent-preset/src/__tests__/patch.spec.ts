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
    // 上游那层策略对所有 preset 生效（它住 host 层），按模式关掉只能由该模式自己抢在它的 waterfall
    // 前面——所以这一行是模式装配的一部分，不是 host 开关（preset 里的行动不了 host 行）。
    const names = (id: string): (string | undefined)[] =>
      pluginsOf(id).map((row) => (typeof row.name === "string" ? row.name : undefined));

    expect(names("coding")).toContain("@morlay/dsh-agent-preset/relax-intent");
    expect(names("chat")).not.toContain("@morlay/dsh-agent-preset/relax-intent");
  });

  it("每个模式只有一行组装行，且住在声明了 isolate 的组里", () => {
    // 组装行的包出口是组装插件（按 config 装能力），所以装配面只有一行：成员与各能力的参数都归包内。
    // 这条判据守的是"它必须在 isolate 组里"——落组外，通道服务会发到 root realm（上游拒装）。
    for (const source of PRESET_SOURCES) {
      const plugins = pluginsOf(source.id);
      const groups = plugins.filter((row) => row.isolate?.["contextAssembler"] !== undefined);

      expect(groups, `${source.id}: 通道组`).toHaveLength(1);
      const [channel] = groups;
      expect(channel?.name).toBe("cordis:group");

      const members = (channel?.config ?? []) as PluginRow[];
      // 组内两行：组装行（通道 + 它承载的能力）与工具说明行（它 inject 通道，所以必须同 realm）。
      expect(
        members.map((row) => row.id),
        `${source.id}: 组内成员`,
      ).toEqual(["context-assembler", "tool-guidance"]);
      expect(members[0]?.name).toBe("@morlay/dsh-context-assembler");

      const outside = plugins.filter(
        (row) =>
          row !== channel &&
          typeof row.name === "string" &&
          row.name.startsWith("@morlay/dsh-context-assembler"),
      );

      expect(outside, `${source.id}: 组外的 context 行`).toEqual([]);
    }
  });

  it("Agent Teams 是可选能力：那一组默认关闭，团队开启时直接派发让位", () => {
    const plugins = pluginsOf("coding");

    // 组默认关闭：`DSH_AGENT_TEAM=1` 才装（`!!js` 在装配期求值，于是同一个产物可按需打开）。
    const team = plugins.find((row) => row.id === "agent-team");
    expect(team?.name).toBe("cordis:group");
    expect(team?.disabled).toEqual({ __jsExpr: 'process.env.DSH_AGENT_TEAM !== "1"' });

    // 同一个开关的另一半：团队装上来时，直接派发那几行让位（两者不同时装）。
    const delegation = plugins.find((row) => row.id === "delegation");
    const subagent = (delegation?.config as PluginRow[] | undefined)?.find(
      (row) => row.id === "tool-subagent",
    );
    expect(subagent?.disabled).toEqual({ __jsExpr: 'process.env.DSH_AGENT_TEAM === "1"' });
  });

  it("标准模式要完整的一套；对话模式用 capabilities 裁掉不要的能力", () => {
    const membersOf = (id: string): PluginRow[] => {
      const channel = pluginsOf(id).find((row) => row.isolate?.["contextAssembler"] !== undefined);
      return (channel?.config ?? []) as PluginRow[];
    };
    const coding = membersOf("coding")[0]?.config as Record<string, unknown> | undefined;
    const chat = membersOf("chat")[0]?.config as Record<string, unknown> | undefined;

    // 缺省即全部：coding 不写 config，组成由包的主出口决定。
    expect(coding).toBeUndefined();
    // 工具说明不再是组装出口的能力：它是组内独立一行（`guidanceRow`），chat 用 `groups: false` 复用它的
    // 工具预处理而不要用法分组。
    expect(chat?.["capabilities"]).toEqual(["assembler", "scope"]);
    expect(chat?.["options"]).toEqual({
      scope: {
        allowTools: ["ask_user_question", "web_search", "web_fetch"],
        instructions: false,
        runtimeContext: false,
      },
    });
    // 工具说明那行的 config 走它自己（组内另一行），不再挂在组装出口的 options 上。
    const guidance = membersOf("chat").find((row) => row.id === "tool-guidance");
    expect(guidance?.name).toBe("@morlay/dsh-agent-toolkit/guidance");
    expect(guidance?.config).toEqual({ groups: false });
  });
});

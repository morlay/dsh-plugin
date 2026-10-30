import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { ROWS, render } from "../../tsdown.config.ts";

const PRESET_DIR = join(process.cwd(), "vendor/deepseek-harness/packages/bundle/web-app/presets");
const PRESET_IDS = ["standard", "ptc", "minimal", "cordis"] as const;
// Agent Teams 用同名工具接管直连委派（`spawn_teammate` 取代 `subagent`，`send_message` / `interrupt_agent`
// 等与 legacy 子代理控制同名），preset 里再装这三行会与 Team 工具互相遮蔽。
const AGENT_TEAM_CONFLICT_ROWS: readonly string[] = [
  "tool-subagent-control",
  "tool-subagent",
  "tool-subagent-fork",
];

interface PresetConfig {
  readonly id: string;
  readonly order?: number;
  readonly plugins: readonly { readonly id?: string }[];
}

function presetConfigOf(rowId: string): PresetConfig {
  const row = ROWS.find((entry) => (entry as { readonly id?: string }).id === rowId) as
    | { readonly config?: PresetConfig }
    | undefined;
  if (row?.config === undefined) throw new Error(`本包没有声明 ${rowId}`);
  return row.config;
}

// 与 agent-team 冲突的行可能在组里（`delegation.config[]`），所以按装配树递归剔除。
function withoutAgentTeamConflicts(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        const id = (item as { readonly id?: string } | null)?.id;
        return id === undefined || !AGENT_TEAM_CONFLICT_ROWS.includes(id);
      })
      .map(withoutAgentTeamConflicts);
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withoutAgentTeamConflicts(item)]),
  );
}

// 上游那份 preset 的 `config`（真源：web-app 的 `presets/<id>.patch.yml`）。
async function upstreamPresetConfig(id: string): Promise<PresetConfig> {
  const layers = yaml.load(await readFile(join(PRESET_DIR, `${id}.patch.yml`), "utf8"), {
    schema: entryListSchema,
  }) as { readonly insert?: readonly { readonly id?: string; readonly config?: PresetConfig }[] }[];
  const row = layers
    .flatMap((layer) => layer.insert ?? [])
    .find((entry) => entry.id === `preset-${id}`);
  if (row?.config === undefined) throw new Error(`上游没有声明 preset-${id}`);
  return row.config;
}

// 入库那份与真源渲染出来的同形：bundle patch 是生成物，真源是本包 `tsdown.config.ts` 的 `patch`
// （`@local/devkit/patch` 的 `renderPatch` 渲染出这里的比对对象，`bundlePatch` 在 build 时把它写回包根）。
describe("mydsh-profile 的 bundle patch", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/bundles/mydsh-profile/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(await render());
    expect(
      (await render()).startsWith(
        "# 本文件由 packages/bundles/mydsh-profile/tsdown.config.ts 生成",
      ),
    ).toBe(true);
  });

  it("四份 preset 逐行复制上游，只删掉与 agent-team 冲突的子代理工具行", async () => {
    for (const id of PRESET_IDS) {
      const upstream = await upstreamPresetConfig(id);
      expect(presetConfigOf(`preset-${id}`)).toEqual(withoutAgentTeamConflicts(upstream));
    }
  });

  it("四份 preset 都不装与 agent-team 冲突的子代理工具行", () => {
    for (const id of PRESET_IDS) {
      const text = JSON.stringify(presetConfigOf(`preset-${id}`));
      for (const conflict of AGENT_TEAM_CONFLICT_ROWS) {
        expect(text).not.toContain(`"id":"${conflict}"`);
      }
    }
  });
});

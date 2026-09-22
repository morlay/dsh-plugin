// 与上游对齐：我们注入的 baseline 身份必须与 base bundle 那行算出来的一模一样，否则上游认不出来，
// 它会再注入一条自己的模板——同会话切到官方 preset 后就会出现两条口径冲突的 AGENTS.md。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { Config as UpstreamConfig } from "@deepseek-ai/dsh-agent-instructions";
// 上游的真算法只在它的源码出口上（发布包不含 src），所以这份比对只能在源码树里跑。
import { resolveConfig, workspaceBaselineIdentity } from "@deepseek-ai/dsh-agent-instructions/src/config.ts";
import { findProjectRoot } from "@deepseek-ai/dsh-agent-instructions/src/files.ts";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { baselineIdentity } from "../baseline.ts";

const BASE_PATCH = join(
  process.cwd(),
  "vendor/deepseek-harness/packages/bundle/base/cordis.patch.yml",
);

interface PatchRow {
  readonly id?: string;
  readonly name?: string;
  readonly config?: Record<string, unknown>;
  readonly insert?: readonly PatchRow[];
}

/** base bundle 给 `agent-instructions` 那行的 config：我们算身份时用的同一份基线。 */
async function baseRowConfig(): Promise<Record<string, unknown>> {
  const rows = yaml.load(await readFile(BASE_PATCH, "utf8"), {
    schema: entryListSchema,
  }) as readonly PatchRow[];
  const inserted = rows.flatMap((row) => row.insert ?? []);
  const row = inserted.find((candidate) => candidate.id === "agent-instructions");

  expect(row?.name).toBe("@deepseek-ai/dsh-agent-instructions");
  return row?.config ?? {};
}

/** 上游自己的算法在同一份 config 与 cwd 下算出的身份。 */
async function upstreamIdentity(
  cwd: string,
  config: Record<string, unknown>,
): Promise<string> {
  const resolved = resolveConfig(UpstreamConfig(config as { maxBytes: number }));
  const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers);
  return workspaceBaselineIdentity(resolved, cwd, projectRoot);
}

describe("baseline 身份与上游对齐", () => {
  it("与 base bundle 那行的 config 算出的身份逐字相等", async () => {
    const cwd = process.cwd();

    expect(await baselineIdentity(cwd)).toBe(await upstreamIdentity(cwd, await baseRowConfig()));
  });

  it("项目根相对 cwd 的位置参与身份（上游语义：工作区形状变了就重新建立基线）", async () => {
    // 身份只编码"项目根在 cwd 的哪一级"（`projectRoot` 是相对路径），不含绝对路径——
    // 所以同一形状的两个工作区身份相同，而"在子目录里"与"在项目根上"不同。
    const subdirectory = join(process.cwd(), "packages");

    expect(await baselineIdentity(subdirectory)).not.toBe(
      await baselineIdentity(process.cwd()),
    );
  });
});

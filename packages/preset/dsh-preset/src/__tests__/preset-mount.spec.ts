import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRESET_SOURCES } from "../../tool/generate-presets.ts";
import { PATCH_ROWS } from "../../tool/patch.ts";

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: unknown;
  readonly config?: unknown;
}

/** 递归收集行里的包名（组行的 config 是子行数组）。 */
function packageNames(rows: readonly Row[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.name === "string") names.push(row.name);
    if (Array.isArray(row.config)) names.push(...packageNames(row.config as Row[]));
  }
  return names;
}

async function sourceOf(pkg: string): Promise<string> {
  const manifest = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  return readFile(join(dirname(manifest), "src", "index.ts"), "utf8").catch(async () =>
    // 有的包入口在别处（例如 context-assembler 把服务放在 channel.ts）。
    readFile(join(dirname(manifest), "src", "channel.ts"), "utf8").catch(() => ""),
  );
}

describe("装配有效性（上游 agent-presets 会拒绝装载的那几类）", () => {
  it("preset 里的行不发布进程全局服务：发布服务的行只能在 host 层", async () => {
    // 上游的判据是 leakedServices(agentCtx, fiber)：preset 子树里新出现的全局服务一律拒绝，
    // 报 "row(s) published process-global service(s) […]"。这里做它的静态等价物——
    // 服务就是 `extends Service`（构造时 provide 自己）。
    const offenders: string[] = [];
    for (const entry of PRESET_SOURCES) {
      for (const pkg of packageNames(entry.rows as readonly Row[])) {
        if (!pkg.startsWith("@morlay/")) continue;
        const source = await sourceOf(pkg);
        if (/\bextends Service\b/u.test(source)) offenders.push(`${entry.id}: ${pkg}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("接管的 host 行在 patch 里按 id 禁用：preset 删不掉 host 行", () => {
    // `agent-instructions` / `tool-skill` 由 base bundle 插在 host 层，而 preset 只能覆盖 config、
    // 删不掉 host 行——不在 patch 里禁用，host 那份就会跟我们的实现抢注册（`skill` 工具撞车那次）。
    const disabled = PATCH_ROWS.filter((row) => row.disabled === true).map((row) => row.id);

    expect(disabled).toContain("agent-instructions");
    expect(disabled).toContain("tool-skill");
  });

  it("每个行都带 id，且同一个 composition 里不重复", () => {
    for (const entry of PRESET_SOURCES) {
      const ids = (entry.rows as readonly Row[]).flatMap((row) =>
        row.id === undefined ? [] : [row.id],
      );

      expect(ids.length).toBe(entry.rows.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

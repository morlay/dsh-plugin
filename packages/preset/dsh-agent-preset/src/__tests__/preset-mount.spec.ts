import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRESET_SOURCES } from "../../tool/presets/index.ts";

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly isolate?: Readonly<Record<string, unknown>>;
  readonly config?: unknown;
}

/** 递归展开行树：组行的 `config` 是子行数组，返回每个叶子行连同它的祖先组。 */
function walk(
  rows: readonly Row[],
  groups: readonly Row[] = [],
): { row: Row; groups: readonly Row[] }[] {
  return rows.flatMap((row) => {
    const withSelf = [...groups, row];
    return Array.isArray(row.config)
      ? walk(row.config as Row[], withSelf)
      : [{ row, groups: withSelf }];
  });
}

/** 行名可能带 subpath（`@morlay/dsh-agent-preset/relax-intent`）：包名与子路径分开。 */
function splitPackage(specifier: string): { name: string; subpath?: string } {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
  const subpath = specifier.slice(name.length + 1);
  return subpath === "" ? { name } : { name, subpath };
}

async function sourceOf(specifier: string): Promise<string> {
  const { name, subpath } = splitPackage(specifier);
  const manifest = fileURLToPath(import.meta.resolve(`${name}/package.json`));
  const source = join(dirname(manifest), "src");
  if (subpath !== undefined) {
    return readFile(join(source, `${subpath}.ts`), "utf8").catch(() => "");
  }
  return readFile(join(source, "index.ts"), "utf8").catch(async () =>
    // 有的包入口在别处（例如 context-assembler 把服务放在 channel.ts）。
    readFile(join(source, "channel.ts"), "utf8").catch(() => ""),
  );
}

/** `super(host, "contextAssembler")` 里的服务名：`extends Service` 的行发布的那个名字。 */
function serviceNameOf(source: string): string | undefined {
  return /super\([^,]+,\s*["']([^"']+)["']\)/u.exec(source)?.[1];
}

describe("装配有效性（上游 agent-preset-registry 会拒绝装载的那几类）", () => {
  it("发布服务的行必须住在 isolate 组里：preset 子树的服务不许进 root realm", async () => {
    // 上游的判据是 leakedServices(agentCtx, fiber)：preset 子树里新出现的全局服务一律拒绝，
    // 报 "Preset services require isolate realms: […]"。这里做它的静态等价物——服务就是
    // `extends Service`（构造时 provide 自己），而隔离由祖先组行的 `isolate` 声明。
    const offenders: string[] = [];
    for (const entry of PRESET_SOURCES) {
      for (const { row, groups } of walk(entry.rows as readonly Row[])) {
        const pkg = row.name;
        if (pkg === undefined || !pkg.startsWith("@morlay/")) continue;
        const source = await sourceOf(pkg);
        if (!/\bextends Service\b/u.test(source)) continue;
        const service = serviceNameOf(source);
        const isolated = groups.some(
          (group) => service !== undefined && group.isolate?.[service] !== undefined,
        );
        if (!isolated) offenders.push(`${entry.id}: ${pkg} (${service ?? "未知服务名"})`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("每个行都带 id，且同一个 composition 里不重复", () => {
    for (const entry of PRESET_SOURCES) {
      const ids = walk(entry.rows as readonly Row[]).flatMap(({ row }) =>
        row.id === undefined ? [] : [row.id],
      );

      expect(ids.length).toBe(walk(entry.rows as readonly Row[]).length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

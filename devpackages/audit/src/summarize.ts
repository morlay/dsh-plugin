#!/usr/bin/env node
// **汇总器**：读 `pnpm -r exec dsh-audit-package` 打出来的逐包 JSON，输出三条判据的结果；
// `--write` 时把「声明未用」的依赖直接从各包 `package.json` 删掉（原 `trim-deps` 的职责，已收敛进来）。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { baselineVerdict, SUBENTRY_BASELINE, TYPE_DISCIPLINE_BASELINE } from "./rules.ts";

/** 一条未用依赖。 */
interface UnusedDep {
  readonly name: string;
  readonly section: "dependencies" | "devDependencies" | "peerDependencies";
}

interface PackageReport {
  readonly pkg: string;
  readonly dir: string;
  readonly group: string;
  readonly faces: readonly string[];
  readonly upstreams: readonly string[];
  readonly unused: readonly UnusedDep[];
  /** 扩展包（`agent-ex`）的越界：入口越界与扩展之间的互相依赖。 */
  readonly exViolations?: readonly string[];
  /** 契约 / 端点面的上游包根值边（类型纪律判据 6）。 */
  readonly contractValueEdges?: readonly string[];
  /** 白名单外的双断言（类型纪律判据 7）。 */
  readonly doubleAssertions?: readonly string[];
  /** 子入口面里以 `../` 开头的导入（面纪律：只许 `./` 与包名/出口）。 */
  readonly subentryParentImports?: readonly string[];
  /** 没有 `src/` 的配置/壳包：不参与源码类判据。 */
  readonly skipped?: boolean;
}

const input = await new Response(process.stdin as unknown as ReadableStream).text();
const reportsAll: PackageReport[] = input
  .split("\n")
  .filter((line) => line.trim().startsWith("{"))
  .map((line) => JSON.parse(line) as PackageReport);
const reports = reportsAll.filter((report) => report.skipped !== true);

// **空输入不能算通过**：pnpm 的 task graph 在 workspace 有循环依赖时会直接拒跑，汇总器读到空输入仍会打印
// 全绿（判据假绿）。走 pnpm 递归之后这一层是最后一道兜底——"没有报告"与"全被跳过"都按没跑起来处理。
if (reportsAll.length === 0) {
  console.error("✗ 没有任何包报告：判据没跑起来（检查 pnpm 递归是否被 workspace 循环依赖挡住）");
  process.exit(1);
}
if (reports.length === 0) {
  console.error("✗ 全部包都被跳过（没有一个带 src/ 的包）：判据没跑起来");
  process.exit(1);
}

const write = process.argv.includes("--write");

const faces = reports.flatMap((report) => report.faces.map((line) => `${report.pkg}  ${line}`));

const owners = new Map<string, string[]>();
for (const report of reports) {
  // 框架层（zephyr 组）共用上游 client 包是设计，不是「两个 owner」。
  if (report.group === "zephyr") continue;
  for (const upstream of report.upstreams) {
    const list = owners.get(upstream) ?? [];
    list.push(report.pkg);
    owners.set(upstream, list);
  }
}
const conflicts = [...owners.entries()]
  .filter(([, list]) => new Set(list).size > 1)
  .map(([key, list]) => key.replace("#", "/") + "  ← " + [...new Set(list)].join(", "));

const unused = reports.flatMap((report) =>
  report.unused.map((dep) => `${report.pkg}  ${dep.name}  [${dep.section}]`),
);

if (write) {
  for (const report of reports) {
    if (report.unused.length === 0) continue;
    const file = join(report.dir, "package.json");
    const manifest = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    for (const dep of report.unused) {
      const section = manifest[dep.section] as Record<string, unknown> | undefined;
      if (section !== undefined) delete section[dep.name];
    }
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(
      `  - ${report.pkg}：删 ${String(report.unused.length)} 条（${report.unused.map((d) => d.name).join(", ")}）`,
    );
  }
}

let failed = 0;
const report = (
  label: string,
  bad: readonly string[],
  options: { readonly hint?: string; readonly total?: number } = {},
): void => {
  if (bad.length === 0) {
    console.log("✓ " + label);
    return;
  }
  failed += bad.length;
  console.log(
    "✗ " + label + "：" + String(options.total ?? bad.length) + " 处" + (options.hint ?? ""),
  );
  for (const line of bad.slice(0, 40)) console.log("    " + line);
};

/**
 * 对着**基线**报一条判据：超出才红（只挡增量），等于打印当前数，低于提示可以下调。
 *
 * 基线是过渡（存量债），删它的判据见 `README.md` 的「基线是过渡」与 `rules.ts` 的注释。
 */
const reportAgainstBaseline = (
  label: string,
  bad: readonly string[],
  options: { readonly current: number; readonly baseline: number; readonly hint?: string },
): void => {
  const { current, baseline } = options;
  const verdict = baselineVerdict(current, baseline);
  const tail =
    verdict === "regressed"
      ? `，超出基线 ${String(baseline)} 达 ${String(current - baseline)} 条`
      : verdict === "improvable"
        ? `（低于基线 ${String(baseline)}：可以下调基线到 ${String(current)}）`
        : `（基线 ${String(baseline)}）`;
  if (verdict === "regressed") failed += current - baseline;
  console.log(
    (verdict === "regressed" ? "✗ " : "✓ ") +
      label +
      "：当前 " +
      String(current) +
      " 处" +
      tail +
      (options.hint ?? ""),
  );
  for (const line of bad.slice(0, 40)) console.log("    " + line);
};

const exViolations = reports.flatMap((report) =>
  (report.exViolations ?? []).map((line) => `${report.pkg}  ${line}`),
);

const contractValueEdges = reports.flatMap((entry) =>
  (entry.contractValueEdges ?? []).map((line) => `${entry.pkg}  ${line}`),
);
const doubleAssertions = reports.flatMap((entry) =>
  (entry.doubleAssertions ?? []).map((line) => `${entry.pkg}  ${line}`),
);
const subentryParentImports = reports.flatMap((entry) =>
  (entry.subentryParentImports ?? []).map((line) => `${entry.pkg}  ${line}`),
);

report("面边界（root→server/ui、ui→host、server→ui）", faces);
report("上游包唯一化（同一上游包的同一个面只该有一个本地 owner）", conflicts);
report("声明未用（依赖清单 vs 源码/scripts/清单其它字段）", unused, {
  hint: write ? "（已删除）" : "（`just audit --write` 一键删）",
});
report("扩展边界（agent-ex 只许 contract / testing / endpoint，且扩展之间零依赖）", exViolations);
reportAgainstBaseline(
  "子入口面禁跨面相对导入（src/{ui,client,server,compat,testing} 里共享契约走包出口；面内 ../ 合法、__tests__ 豁免）",
  subentryParentImports,
  {
    current: subentryParentImports.length,
    baseline: SUBENTRY_BASELINE["parent-import"],
  },
);
reportAgainstBaseline(
  "契约 / 端点面上游值边（包根值导入；`import type` / `export type` 不算）",
  contractValueEdges,
  {
    current: contractValueEdges.length,
    baseline: TYPE_DISCIPLINE_BASELINE["contract-value-edge"],
  },
);
// 双断言的条目是「文件 + 处数」：标题给**处数**（判据的单位），明细给文件。
const doubleAssertTotal = doubleAssertions.reduce((sum, line) => {
  const matched = /(\d+) 处$/u.exec(line);
  return sum + (matched === null ? 1 : Number(matched[1]));
}, 0);
reportAgainstBaseline(
  "双断言白名单（`as unknown as` 只许边界桥；白名单见 devpackages/audit/src/rules.ts）",
  doubleAssertions,
  {
    current: doubleAssertTotal,
    baseline: TYPE_DISCIPLINE_BASELINE["double-assertion"],
    hint: "（" + String(doubleAssertions.length) + " 个文件）",
  },
);

process.exit(failed === 0 || write ? 0 : 1);

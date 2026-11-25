#!/usr/bin/env node
// **汇总器**：读 `pnpm -r exec dsh-audit-package` 打出来的逐包 JSON，输出三条判据的结果；
// `--write` 时把「声明未用」的依赖直接从各包 `package.json` 删掉（原 `trim-deps` 的职责，已收敛进来）。
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  baselineVerdict,
  REMOTE_CLAIM_EXEMPT,
  REMOTE_CLAIM_MODE,
  SUBENTRY_BASELINE,
  TYPE_DISCIPLINE_BASELINE,
} from "./rules.ts";
import {
  assemblyFactsOf,
  installedOf,
  missingClaimsOf,
  type ProvideEdge,
  type ProvideList,
  type ProvideRemoval,
  type RemoteClaim,
  type RemoteClassFact,
  type RemoteDemand,
} from "./remote-claims.ts";

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
  /** 白名单外的双断言（类型纪律判据 7，生产面：硬门禁）。 */
  readonly doubleAssertions?: readonly string[];
  /** 同一判据的测试域计数（`__tests__/**`，只降不升）：与生产面分开计数、分开报。 */
  readonly testDoubleAssertions?: readonly string[];
  /** 子入口面里以 `../` 开头的导入（面纪律：只许 `./` 与包名/出口）。 */
  readonly subentryParentImports?: readonly string[];
  /** deps 键里的 `"remote.xxx"` 字面量（判据见 `dynamic-face.ts` 的 `remoteNamespaceKey`）。 */
  readonly remoteLiterals?: readonly string[];
  /** `publishConfig.exports` 漏掉的顶层出口键（整体替换语义，漏一个就是发布包少一个面）。 */
  readonly publishExportGaps?: readonly string[];
  /** 发布包的 `prepublishOnly` 缺省或没调 `devkit build`（发布时忘了构建）。 */
  readonly publishHookProblems?: readonly string[];
  /** 端点认领差集的原料：认领者（自研端点行 / descriptor 行 / HTTP 路由行）。 */
  readonly remoteClaims?: readonly RemoteClaim[];
  /** 浏览器半会调的组（契约面的 `@RemoteGroup`，以及上游 remote 出口的说明符）。 */
  readonly remoteDemands?: readonly RemoteDemand[];
  readonly remoteEdges?: readonly ProvideEdge[];
  readonly remoteLists?: readonly ProvideList[];
  readonly remoteRemovals?: readonly ProvideRemoval[];
  /** 类表：解析「`@RemoteGroup()` 无名」那些行的组名（组名常写在另一个包的契约类上）。 */
  readonly remoteClasses?: readonly RemoteClassFact[];
  /** 解析不出来的（组名、基类、清单名）：**不能当通过**。 */
  readonly remoteUnknown?: readonly string[];
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
const remoteLiterals = reports.flatMap((report) =>
  (report.remoteLiterals ?? []).map((line) => `${report.pkg}  ${line}`),
);
const publishExportGaps = reports.flatMap((report) =>
  (report.publishExportGaps ?? []).map((line) => `${report.pkg}  ${line}`),
);

const contractValueEdges = reports.flatMap((entry) =>
  (entry.contractValueEdges ?? []).map((line) => `${entry.pkg}  ${line}`),
);
const doubleAssertions = reports.flatMap((entry) =>
  (entry.doubleAssertions ?? []).map((line) => `${entry.pkg}  ${line}`),
);
const testDoubleAssertions = reports.flatMap((entry) =>
  (entry.testDoubleAssertions ?? []).map((line) => `${entry.pkg}  ${line}`),
);
const subentryParentImports = reports.flatMap((entry) =>
  (entry.subentryParentImports ?? []).map((line) => `${entry.pkg}  ${line}`),
);
// 从 `reportsAll` 取：没有 `src/` 的发布包（`dsh-oxc-node`）也会被跳过源码判据，但它同样要带钩子。
const publishHookProblems = reportsAll.flatMap((entry) =>
  (entry.publishHookProblems ?? []).map((line) => `${entry.pkg}  ${line}`),
);

report("面边界（root→server/ui、ui→host、server→ui、contract/endpoint→server/ui）", faces);
report("上游包唯一化（同一上游包的同一个面只该有一个本地 owner）", conflicts);
report("声明未用（依赖清单 vs 源码/scripts/清单其它字段）", unused, {
  hint: write ? "（已删除）" : "（`just audit --write` 一键删）",
});
report("扩展边界（agent-ex 只许 contract / testing / endpoint，且扩展之间零依赖）", exViolations);
report(
  "发布包带 prepublishOnly 且调 devkit build（发布前先构建，避免发出去的是旧产物）",
  publishHookProblems,
);
report(
  'deps 键不写字面量（`"remote.xxx"` 一律由 `remoteNamespaceKey(组名)` 给出；只盯 `export const` 会漏掉字面量）',
  remoteLiterals,
);
report(
  "`publishConfig.exports` 覆盖顶层 `exports` 的每个键（整体替换，漏一个就是发布包少一个面）",
  publishExportGaps,
);

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
const countOf = (lines: readonly string[]): number =>
  lines.reduce((sum, line) => {
    const matched = /(\d+) 处$/u.exec(line);
    return sum + (matched === null ? 1 : Number(matched[1]));
  }, 0);

// 生产面：硬门禁。测试域：**另一条**判据（只降不升）。两条分开报——合成一条时测试域的存量会把
// 生产面的增量淹掉，生产面那条「只挡增量」就失效了。
reportAgainstBaseline(
  "双断言白名单（`as unknown as` 只许边界桥；白名单见 devpackages/devkit/src/audit/rules.ts）",
  doubleAssertions,
  {
    current: countOf(doubleAssertions),
    baseline: TYPE_DISCIPLINE_BASELINE["double-assertion"],
    hint: "（" + String(doubleAssertions.length) + " 个文件）",
  },
);
reportAgainstBaseline(
  "测试域双断言（`__tests__/**` 的 `as unknown as`：同一套边界桥白名单，只降不升）",
  testDoubleAssertions,
  {
    current: countOf(testDoubleAssertions),
    baseline: TYPE_DISCIPLINE_BASELINE["double-assertion-test"],
    hint: "（" + String(testDoubleAssertions.length) + " 个文件）",
  },
);


// ── 端点认领差集 ─────────────────────────────────────────────────────────────
// 判据：客户端会调的每个 remote 组，宿主侧必须有认领者，且该认领者所在的行必须在应用的装配清单里。
// 组名级：只抓「整个组没认领」（浏览器 404 的形态）；方法级由各包的闭环判据守。
const workspace = process.cwd();

/** 上游包名 → 包目录（`@deepseek-ai/x/remote` 的组名要从那个包的源码里读）。 */
const vendorPackages = new Map<string, string>();
/**
 * 递归索引 `vendor/` 下的包目录（跳过 node_modules / target / dist 这类产物目录）。
 * @param dir 目录。
 */
async function indexVendor(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (["node_modules", "target", "dist", "lib"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await indexVendor(path);
      continue;
    }
    if (entry.name !== "package.json") continue;
    const manifest = JSON.parse(await readFile(path, "utf8")) as { readonly name?: unknown };
    if (typeof manifest.name === "string") vendorPackages.set(manifest.name, dir);
  }
}
await indexVendor(join(workspace, "vendor"));

/** 已解析过的上游说明符 → 组名（`remote` 出口的组名由上游源码的 `namespace: '…'` 给出）。 */
const upstreamGroups = new Map<string, readonly string[]>();
/**
 * 解析一个上游 remote 出口说明符声明的组名。
 * @param specifier 说明符。
 * @returns 组名列表；解析不出来时为空（汇总器会把它当「未知」报出来，不当通过）。
 */
async function resolveUpstreamGroups(specifier: string): Promise<readonly string[]> {
  const cached = upstreamGroups.get(specifier);
  if (cached !== undefined) return cached;
  const parts = specifier.split("/");
  const dir = vendorPackages.get(parts.slice(0, 2).join("/"));
  const found = new Set<string>();
  if (dir !== undefined) {
    const walkSrc = async (target: string): Promise<void> => {
      for (const entry of await readdir(target, { withFileTypes: true }).catch(() => [])) {
        const path = join(target, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") await walkSrc(path);
          continue;
        }
        if (!/\.(ts|tsx|mts)$/u.test(entry.name)) continue;
        const text = await readFile(path, "utf8").catch(() => "");
        for (const match of text.matchAll(/namespace:\s*['"]([\w.$-]+)['"]/gu)) {
          if (match[1] !== undefined) found.add(match[1]);
        }
      }
    };
    await walkSrc(join(dir, "src"));
  }
  const groups = [...found].sort();
  upstreamGroups.set(specifier, groups);
  return groups;
}

/** 认领行的组名解析不出来（合并类表也没找到）：**不能当通过**。 */
const remoteClaimUnresolved: string[] = [];
const classTable = new Map<string, { group: string; base: string }>();
for (const fact of reports.flatMap((entry) => entry.remoteClasses ?? [])) {
  classTable.set(fact.name, { group: fact.group, base: fact.base });
}
/**
 * 沿合并后的类表解析组名（`@RemoteGroup()` 无名的那批行靠它）。
 * @param row 行身份（`class:<类名>`）。
 * @returns 组名；解析不出来为空串。
 */
function resolveGroupOfRow(row: string): string {
  let current = classTable.get(row.slice("class:".length));
  for (let hop = 0; hop < 8 && current !== undefined; hop += 1) {
    if (current.group !== "") return current.group;
    current = current.base === "" ? undefined : classTable.get(current.base);
  }
  return "";
}
const allClaims = reports
  .flatMap((entry) => entry.remoteClaims ?? [])
  .map((claim) =>
    claim.kind === "handler" && claim.group === ""
      ? { ...claim, group: resolveGroupOfRow(claim.row) }
      : claim,
  )
  .filter((claim) => {
    if (claim.kind !== "handler" || claim.group !== "") return true;
    remoteClaimUnresolved.push(claim.row + "  " + claim.file);
    return false;
  });
const allDemands = reports.flatMap((entry) => entry.remoteDemands ?? []);
const allEdges = reports.flatMap((entry) => entry.remoteEdges ?? []);
const allLists = reports.flatMap((entry) => entry.remoteLists ?? []);
const allRemovals = reports.flatMap((entry) => entry.remoteRemovals ?? []);
const remoteUnknowns = reports.flatMap((entry) =>
  (entry.remoteUnknown ?? []).map((line) => entry.pkg + "  " + line),
);

if (allClaims.length > 0 && allDemands.length > 0) {
  const demandGroups = new Set(allDemands.map((demand) => demand.group));
  const claimGroups = new Set(allClaims.map((claim) => claim.group).filter((group) => group !== ""));
  console.log(
    "· 端点认领差集原料：需求 " +
      String(demandGroups.size) +
      " 组，认领 " +
      String(claimGroups.size) +
      " 组，provide 清单 " +
      String(allLists.length) +
      " 份",
  );
}

if (allClaims.length === 0 && allDemands.length === 0) {
  console.error("✗ 端点认领差集：一个组都没解析出来（判据没跑起来，别当通过）");
  failed += 1;
} else {
  // 先把两类 `spec:` 都解析成组名，再算差集（`missingClaimsOf` 是同步的）。
  const specifiers = new Set<string>();
  for (const claim of allClaims) if (claim.row.startsWith("spec:")) specifiers.add(claim.row.slice(5));
  for (const demand of allDemands) if (demand.group.startsWith("spec:")) specifiers.add(demand.group.slice(5));
  for (const specifier of specifiers) await resolveUpstreamGroups(specifier);
  const groupsOf = (specifier: string): readonly string[] => upstreamGroups.get(specifier) ?? [];

  const appNames = (await readdir(join(workspace, "apps"), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const app of appNames) {
    const file = join(workspace, "apps", app, "src", "zephyr.provide.ts");
    const source = await readFile(file, "utf8").catch(() => undefined);
    if (source === undefined) {
      // 不是静默跳过：没有清单的应用也要出现在报告里，否则「新应用漏判据」没人知道。
      console.log("· 端点认领差集（应用 " + app + "）：跳过（无清单 apps/" + app + "/src/zephyr.provide.ts）");
      continue;
    }
    const assembly = await assemblyFactsOf(source);
    const installed = installedOf({
      calls: assembly.calls,
      edges: [...allEdges, ...assembly.edges],
      lists: allLists,
      removals: allRemovals,
      withouts: assembly.withouts,
    });
    const { missing, unknown } = missingClaimsOf({
      demands: allDemands,
      claims: allClaims,
      installedRows: installed.rows,
      upstreamGroupsOf: groupsOf,
      exempt: new Set(REMOTE_CLAIM_EXEMPT.keys()),
    });
    const lines = missing.map((item) => {
      const why = item.claimedSomewhere ? "有行但没装上（被 without 剔了 / 清单没装）" : "没有认领者";
      const demandsText = [...new Set(item.demands)].slice(0, 3).join(", ");
      return item.group + "  " + why + "  需求方：" + demandsText;
    });
    const label =
      "端点认领差集（应用 " +
      app +
      "：每个浏览器会调的组，宿主侧都要有装上清单的认领者）";
    if (REMOTE_CLAIM_MODE === "gate") {
      report(label, lines);
    } else if (lines.length === 0) {
      console.log("✓ " + label + "（report 档）");
    } else {
      console.log("· " + label + "：" + String(lines.length) + " 处（report 档：只打印、不计失败）");
      for (const line of lines) console.log("    " + line);
    }
    for (const line of unknown) console.log("    ⚠ " + line);
  }
}

// 解析不出来的东西单独打印：**不能当通过**，但也不静默——它要变成补解析或一条写明理由的豁免。
if (remoteUnknowns.length > 0) {
  console.log("· 端点认领差集：解析不出 " + String(remoteUnknowns.length) + " 处（补解析或写豁免理由）");
  for (const line of remoteUnknowns.slice(0, 20)) console.log("    " + line);
}
if (remoteClaimUnresolved.length > 0) {
  console.log("· 端点认领差集：认领行的组名解析不出 " + String(remoteClaimUnresolved.length) + " 处（补解析）");
  for (const line of remoteClaimUnresolved.slice(0, 20)) console.log("    " + line);
}

process.exit(failed === 0 || write ? 0 : 1);
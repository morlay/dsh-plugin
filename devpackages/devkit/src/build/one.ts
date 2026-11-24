// 单包构建：`devkit build` 用 `pnpm -r exec` 在每个包目录里跑一次（包列表由 pnpm 决定）。
// 没有 TS 源码入口的包（`@morlay/dsh-oxc-node` 那种手写单文件）不打印也不改清单。
import { relative, join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRootOf } from "@local/dts-prepare";
import { buildPackage, planOf } from "./compile.ts";
import { writeBuildManifest, type BundleRow } from "./package-exports.ts";

const cwd = process.cwd();
const plan = await planOf(cwd);

if (Object.keys(plan.entries).length > 0) {
  const artifacts = await buildPackage(cwd, plan);
  // bundle 包的行声明在 `src/dsh-bundle.ts` 里（`rows`）；读不到就是空清单。
  const bundleSource = plan.bundleSource;
  const bundleRows: readonly BundleRow[] =
    plan.bundle === true && bundleSource !== undefined
      ? ((
          (await import(pathToFileURL(join(cwd, bundleSource)).href)) as {
            rows?: readonly BundleRow[];
          }
        ).rows ?? [])
      : [];
  const entries =
    plan.client === undefined ? plan.entries : { ...plan.entries, client: plan.client.source };
  await writeBuildManifest(cwd, {
    entries,
    artifacts,
    ...(plan.client === undefined ? {} : { clientEntry: "client" }),
    // bundle 包不出声明（dsh 行入口没有类型消费面）；其余包按入口聚合声明。
    declarationFiles: (entry) =>
      plan.bundle === true || entry === "client" ? [] : [entry + ".d.mts"],
    ...(plan.bundle === true ? { bundle: { rows: bundleRows } } : {}),
    hidden: plan.hidden,
    ...(plan.bin === undefined ? {} : { bin: plan.bin }),
  });
  process.stdout.write("built " + relative(await repoRootOf(cwd), cwd) + "\n");
}

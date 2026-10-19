import { resolve } from "node:path";
import { generateTypert } from "./index.ts";

// 预演 / 对照用 CLI（不写产物）：
//   pnpm dlx @oxc-node/cli devpackages/typert-generator/src/cli.ts <upstreamRoot> [--dts-root=<dir>] [包名…]
// 缺省声明树与 `just vendor prebuild` / tsdown 走同一条流程（见 `generateTypert` 的 `dtsRoot` 说明）：
// 调用方不需要额外的 dts 子命令。`--dts-root` 只用于对照某一份已生成的声明树。
const positional: string[] = [];
let dtsRoot: string | undefined;
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith("--dts-root=")) dtsRoot = resolve(argument.slice("--dts-root=".length));
  else positional.push(argument);
}
const [upstreamRoot, ...packages] = positional;
if (upstreamRoot === undefined) {
  console.error("用法: cli.ts <upstreamRoot> [--dts-root=<dir>] [包名…]");
  process.exit(1);
}
const artifacts = await generateTypert({
  upstreamRoot: resolve(upstreamRoot),
  ...(dtsRoot === undefined ? {} : { dtsRoot }),
  ...(packages.length === 0 ? {} : { packages }),
});
for (const artifact of artifacts) {
  for (const file of artifact.files)
    console.log(`=== ${artifact.package} → ${file.path} ===\n${file.text}`);
}
console.error(
  `[typert] 包 ${String(artifacts.length)} 个，invocation ${String(
    artifacts.reduce((total, artifact) => total + artifact.invocations, 0),
  )} 条`,
);

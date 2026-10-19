/**
 * 预编译缓存指纹的输入集：上游包的 `lib/`（typert 产物）与 `src/` 都是打包输入。
 *
 * 现场：`just vendor prebuild` 重新生成 `lib/typert.*.ts` 后，指纹只盯 `src/` 时会继续命中旧缓存，
 * 浏览器拿到的还是旧 descriptor（`terminal/retain` 仍发 `workspaceFileScopeId`，宿主按新 descriptor
 * 拒掉 `missing "sessionId"`）。
 */
import { join } from "node:path";
import { expect, test } from "vitest";
import { watchOf } from "../index.ts";

test("上游包（非 node_modules）：指纹看 src 与 lib", () => {
  const root = join(process.cwd(), "vendor", "deepseek-harness", "packages", "api", "demo");
  expect(watchOf(root, join(root, "src", "index.ts"))).toEqual([
    join(root, "src"),
    join(root, "lib"),
  ]);
});

test("node_modules 里的三方包：只看 package.json（版本已进缓存目录名）", () => {
  const root = join(
    process.cwd(),
    "node_modules",
    ".pnpm",
    "react@18.3.1",
    "node_modules",
    "react",
  );
  expect(watchOf(root, join(root, "index.js"))).toEqual([join(root, "package.json")]);
});

test("没有包根时退到入口文件", () => {
  const entry = join(process.cwd(), "dist", "index.js");
  expect(watchOf(undefined, entry)).toEqual([entry]);
});

// **运行时不许带开发态的东西**：`zephyr-app` 只装运行时（宿主与浏览器双态）。
//
// 两类东西都不许出现：
//   1. **构建链**：vite / chokidar / lightningcss / rolldown —— 它们归 `@morlay/zephyr-dev`；
//   2. **node 运行时补强**：`@oxc-project/runtime`（rolldown 给装饰器注入的 helper）——
//      它的 home 只有一处：`packages/boot/dsh-oxc-node`（本仓库的 TS 运行时入口，
//      `oxc-transform` 与它必须同版本线）。框架包声明它等于把"node 怎么跑 TS"塞进运行时契约。
//
// 为什么钉在清单上而不是只钉 import：同一个包里混着两套依赖时，**浏览器面**就要靠 external 表
// 硬挡 rolldown；而"某处悄悄又 import 了 vite"这件事在源码里看不出来（可能在注释、动态 import
// 或某个深层文件里）。清单是这条边界唯一可机器判的地方。
//
// 判据来源：`packages/zephyr/.agents/designs/20261113-开发构建与产物布局.md` 的验收判据 6。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 本包根（本文件在 `src/__tests__/` 下）。 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 构建链：全部归 `@morlay/zephyr-dev`。 */
const BUILD_CHAIN = ["vite", "chokidar", "lightningcss", "rolldown"] as const;

/** node 运行时补强：home 只有 `packages/boot/dsh-oxc-node`。 */
const NODE_RUNTIME = ["@oxc-project/runtime"] as const;

/** 清单的三份依赖表。 */
interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/**
 * 读本包清单。
 * @returns 清单对象。
 */
async function manifest(): Promise<Manifest> {
  return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Manifest;
}

describe("zephyr-app 的依赖清单里没有开发态的东西", () => {
  it("dependencies 里没有构建链", async () => {
    const { dependencies = {} } = await manifest();
    for (const name of [...BUILD_CHAIN, ...NODE_RUNTIME]) {
      expect(Object.keys(dependencies), `${name} 属于 @morlay/zephyr-dev 或 boot`).not.toContain(
        name,
      );
    }
  });

  it("peerDependencies 里没有 rolldown（它是 zephyr-dev 的普通依赖）", async () => {
    const { peerDependencies = {} } = await manifest();
    for (const name of [...BUILD_CHAIN, ...NODE_RUNTIME]) {
      expect(Object.keys(peerDependencies)).not.toContain(name);
    }
  });

  it("devDependencies 里也没有（测试用不到构建器与 node 补强：那些用例随实现搬走了）", async () => {
    const { devDependencies = {} } = await manifest();
    for (const name of [...BUILD_CHAIN, ...NODE_RUNTIME]) {
      expect(Object.keys(devDependencies)).not.toContain(name);
    }
  });
});

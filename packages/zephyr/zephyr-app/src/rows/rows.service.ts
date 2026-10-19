// 行清单的默认实现：包名列表由装配方传入；client 半的源文件按包的 `exports` 解析（node 原生）。
import { createRequire } from "node:module";
import { join } from "node:path";
import { Injectable } from "@morlay/zephyr";
import { ClientRows } from "./rows.contract.ts";

@Injectable()
export class ClientRowsDefault extends ClientRows {
  constructor(private readonly value: readonly string[] = []) {
    super();
  }

  get rows(): readonly string[] {
    return this.value;
  }

  get clientPaths(): ReadonlyMap<string, string> {
    const paths = new Map<string, string>();
    for (const name of this.value) {
      const entry = clientEntryOf(name);
      if (entry !== undefined) paths.set(name, entry);
    }
    return paths;
  }
}

/**
 * 包名 → 它的 client 半源文件。
 *
 * **只认我们自己的约定 `./client-module`**（不猜上游的 `./client`）：谁要给前端用，
 * 就在自己的清单里显式登记这个出口——包括 client 侧的 remote 面（它也是 client 半的一部分）。
 * @param name - 包名。
 * @returns client 入口的绝对路径；没登记就是 `undefined`。
 */
function clientEntryOf(name: string): string | undefined {
  try {
    const requireFrom = createRequire(join(process.cwd(), "package.json"));
    requireFrom.resolve(`${name}/package.json`);
    return requireFrom.resolve(`${name}/client-module`);
  } catch {
    return undefined;
  }
}

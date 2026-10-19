// 行清单的默认实现：包名列表由装配方传入；client 半的源文件按包的 `exports` 解析（node 原生）。
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Injectable } from "@morlay/zephyr";
import { ClientRows } from "./client-rows.contract.ts";

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

/** 包名 → 它的 client 半源文件（从装配根清单解析 `exports`）。 */
function clientEntryOf(name: string): string | undefined {
  try {
    const requireFrom = createRequire(join(process.cwd(), "package.json"));
    const manifestPath = requireFrom.resolve(`${name}/package.json`);
    const root = dirname(manifestPath);
    // 解析顺序：`./client-module`（我们的约定）→ `./client`（上游约定）。
    for (const key of ["./client-module", "./client"]) {
      try {
        return requireFrom.resolve(`${name}/${key.slice(2)}`);
      } catch {
        continue;
      }
    }
    return join(root, "src", "client", "index.ts");
  } catch {
    return undefined;
  }
}

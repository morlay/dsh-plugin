// 我们自己的包用它管理自己的配置：**每个包一份** `$DSH_HOME/settings/<package>/config.json`，格式由各包自己定。
// 它**不占用**上游的 `settings` 服务名——上游插件继续用它们自己的 `settings` + `config-editor`（profile patch），
// 两套互不干扰。
import { Injectable } from "@morlay/zephyr";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

@Injectable()
export class PackageConfig {
  readonly root: string = join(
    process.env.DSH_HOME ?? join(process.cwd(), ".dsh-store"),
    "settings",
  );

  pathOf(pkg: string): string {
    return join(this.root, pkg, "config.json");
  }

  async read<T>(pkg: string): Promise<(T & Record<string, unknown>) | undefined> {
    try {
      return JSON.parse(await readFile(this.pathOf(pkg), "utf8")) as T & Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  async write(pkg: string, value: unknown): Promise<void> {
    await mkdir(join(this.root, pkg), { recursive: true });
    await writeFile(this.pathOf(pkg), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

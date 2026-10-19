// 默认值：dataDir = `<profileDir>/.dsh-store`，profileDir = 当前运行目录，dev=true，聚合名单为空。
import { Injectable } from "@morlay/zephyr";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppEnv, type AppEnvValues } from "./app-env.contract.ts";

@Injectable()
export class AppEnvDefault extends AppEnv {
  readonly values: AppEnvValues = {
    profileDir: process.cwd(),
    dataDir: join(process.cwd(), ".dsh-store"),
    dev: true,
    aggregate: [],
  };

  readonly packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

  readonly appBootDir = join(this.packageRoot, "src", "client", "app-boot");

  readonly profileManifest = join(this.values.profileDir, "package.json");

  readonly cacheDir = join(this.values.profileDir, "node_modules", ".dsh-client-modules");
}

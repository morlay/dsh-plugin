// `profileContext` 的运行时实现（原生名 `profileContext`）：`settings` / `config-editor` 这类上游行
// 按**原生名**取它。launcher 形态由 app 传值；代码组合形态直接按 env/cwd 推。
import { Service } from "@deepseek-ai/cordis";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Injectable } from "@morlay/zephyr";
import { join } from "node:path";

type CordisContext = ConstructorParameters<typeof Service>[0];

@Injectable()
export class ProfileContextService extends Service {
  static readonly packageName = "@morlay/dsh-web-app";

  readonly name: string = "custom";
  readonly dir: string;
  readonly patchPath: string;
  readonly installAnchor: string;
  readonly cwd: string;
  readonly home: string;
  readonly startedBundles: readonly string[] = [];
  readonly overlays: readonly unknown[] = [];
  readonly telemetryDisabledEnv: string | undefined;

  constructor(ctx: CordisContext) {
    super(ctx, "profileContext");
    const dir = process.cwd();
    this.dir = dir;
    this.cwd = dir;
    // 可写的 profile patch：`config-editor` 的 `documentPath` 就是它，settings 保存会写这里。
    // 放在 `$DSH_HOME` 下（仓库目录不该被运行期写）。
    this.home = process.env.DSH_HOME ?? join(dir, ".dsh-store");
    this.patchPath = join(this.home, "cordis.patch.yml");
    this.installAnchor = dir;
    this.telemetryDisabledEnv = process.env.DSH_TELEMETRY_DISABLED;
    this.ensureDocument();
  }

  /** 确保 profile patch 存在（settings 写盘前 `config-editor` 会读它）。 */
  private ensureDocument(): void {
    void mkdir(dirname(this.patchPath), { recursive: true })
      .then(() => writeFile(this.patchPath, "", { flag: "a" }))
      .catch(() => undefined);
  }
}

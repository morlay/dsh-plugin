// 默认读面：`{DSH_HOME}/sandbox.toml`。
//
// **文件不存在就写一份默认的**：沙箱的规则不是「空着也能用」——一条 `rw` 都没有时只有工作区可写，
// 症状是 agent-browser 起不来、`XDG_CACHE_HOME` 写不进去。第一次启动就把可用集合落到文件里，
// 用户照着改，比让他从空文件猜语法强。
//
// 写失败（只读盘、权限）**不影响启动**：内置那份规则仍然生效（读面返回它），只记一条警告——
// 规则面缺失是产品问题，文件写不进去是环境问题，不该把启动挡住。
import { readFile, writeFile } from "node:fs/promises";
import { dshHomePath } from "@morlay/zephyr-app";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { SandboxFile } from "./contract/sandbox-file.contract.ts";
import { DEFAULT_SANDBOX_TOML } from "./defaults.ts";

@Injectable()
export class SandboxFileDefault extends SandboxFile {
  readonly path = dshHomePath("sandbox.toml");

  private readonly logger = inject.optional(Logger);

  /**
   * 诊断：`Logger` 是可选注入（纯规则装配里没有它），缺的时候拿到的是注入占位而不是实例。
   * 这里判一次成员类型，缺了就当没有——诊断丢了不影响规则面正确性。
   */
  private log(level: "info" | "warn", message: string, ...args: unknown[]): void {
    const sink = this.logger as { info?: unknown; warn?: unknown } | undefined;
    const write = sink?.[level];
    if (typeof write === "function") write.call(sink, message, ...args);
  }

  async read(): Promise<string | undefined> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // 权限、路径是目录这类是环境问题：读成「没配规则」会让沙箱静默退回官方行为，比启动失败更难查。
        throw error;
      }
    }
    return await this.createDefault();
  }

  /** 首次启动：把默认规则落盘；写不进去就只在内存里用它，并记一条警告。 */
  private async createDefault(): Promise<string> {
    try {
      await writeFile(this.path, DEFAULT_SANDBOX_TOML, { encoding: "utf8", flag: "wx" });
      this.log("info", "已创建默认沙箱规则：%s", this.path);
    } catch (error) {
      // `EEXIST`：并发启动时别人先写了，读回来用他的那份。其它错误：内置那份照样生效。
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return await readFile(this.path, "utf8").catch(() => DEFAULT_SANDBOX_TOML);
      }
      this.log("warn", "默认沙箱规则写不进去（%s），本次用内置那份：%s", this.path, String(error));
    }
    return DEFAULT_SANDBOX_TOML;
  }
}

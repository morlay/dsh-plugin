/**
 * 浏览器产物的版本元数据（`DSH_CLIENT_*`）。
 *
 * 这几个值**不由我们定义**：上游的 `scripts/client-build-environment.ts` 负责从**上游仓库**（vendor 里那份
 * 副本）的 `package.json` 与 git 取版本 / 短 commit / 工作区是否 dirty，产物写在
 * `<vendor>/.dsh-build/client-build-environment.json`。`just prepare` 的 `client-meta` 步骤跑一次上游生成器
 * 产出它；这里只是把它读出来、注入宿主进程的环境，`@morlay/dsh-client-modules` 构建 client 产物时从环境取。
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findWorkspaceRoot } from "./workspace.ts";

/** 上游生成的那份记录（上游 `CLIENT_BUILD_RECORD_PATH`）。 */
export const CLIENT_BUILD_RECORD = join(".dsh-build", "client-build-environment.json");

/** vendor（上游源码副本）目录：`DEEPSEEK_HARNESS_DIR` 优先，默认 `vendor/deepseek-harness`。 */
async function harnessRoot(workspace: string): Promise<string | undefined> {
  const root = await findWorkspaceRoot(workspace).catch(() => undefined);
  if (root === undefined) return undefined;
  return resolve(root, process.env["DEEPSEEK_HARNESS_DIR"] ?? join("vendor", "deepseek-harness"));
}

/**
 * 读上游生成的环境变量组；记录缺失或坏掉给空对象（不挡流程——前端那几处自己判 `undefined`）。
 * @param workspace - app 工作区（用它上溯到仓库根，再定位 vendor）。
 */
export async function readClientBuildEnvironment(
  workspace: string,
): Promise<Record<string, string>> {
  const harness = await harnessRoot(workspace);
  if (harness === undefined) return {};
  const raw = await readFile(join(harness, CLIENT_BUILD_RECORD), "utf8").catch(() => undefined);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as { environment?: Record<string, unknown> };
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.environment ?? {})) {
      if (name.startsWith("DSH_CLIENT_") && typeof value === "string") environment[name] = value;
    }
    return environment;
  } catch {
    return {};
  }
}

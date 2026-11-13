// 测试辅助：让「命令编排」在没有真构建、没有真端口的地方也能判。
//
// 这里的替身只替**外部动作**（vite / pnpm / rolldown），不替内核自己的解析与装配。
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BuildInput, BuildSteps } from "../build/builder.ts";
import type { ResolvedConfig } from "../config/contract.ts";
import { layoutOf } from "../layout.ts";

/**
 * 造一个临时工作区。
 * @param files - 相对路径 → 内容。
 * @returns 目录的绝对路径。
 */
export async function tempWorkspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zephyr-cli-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

/**
 * 一份可直接喂给命令的解析结果（入口文件由调用方保证存在）。
 * @param options - 工作区与可选覆盖。
 * @returns 解析结果。
 */
export function resolvedFor(options: {
  readonly workspace: string;
  readonly appName?: string;
  readonly outDir?: string;
}): ResolvedConfig {
  const layout = layoutOf(options.workspace, options.outDir);
  return {
    config: { server: { entry: "./src/server.ts" }, client: { entry: "./src/client/index.tsx" } },
    configFile: join(options.workspace, "zephyr.config.ts"),
    workspace: options.workspace,
    layout,
    serverEntry: join(options.workspace, "src/server.ts"),
    clientEntry: join(options.workspace, "src/client/index.tsx"),
    appName: options.appName ?? "zephyr-app",
  };
}

/** 记录调用的三步替身：不做任何外部动作。 */
export function fakeBuildSteps(): BuildSteps & { readonly calls: BuildInput[] } {
  const calls: BuildInput[] = [];
  const record = async (input: BuildInput): Promise<void> => {
    calls.push(input);
  };
  return { calls, client: record, runtime: record, entry: record, prebundle: record };
}

/**
 * 收集输出的流。
 * @returns 行数组与写入函数。
 */
export function memoryStream(): {
  readonly lines: string[];
  readonly write: (line: string) => void;
} {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

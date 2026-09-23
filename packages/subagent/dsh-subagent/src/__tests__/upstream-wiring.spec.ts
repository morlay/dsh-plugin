import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const VENDOR = join(process.cwd(), "vendor/deepseek-harness/packages/subagent/subagent/src");
const FORK = join(process.cwd(), "packages/subagent/dsh-subagent/src");
const VENDOR_PREFIX = "../../../../vendor/deepseek-harness/packages/subagent/subagent/src/";
const CORDIS_DECLARATION = "declare module '@deepseek-ai/cordis' {";
const RETURN_GUIDANCE = "export function withContinuableReturnGuidance(";
const RETAINED = ["index.ts", "continuation.ts", "continuation-messages.ts"] as const;

let vendor: Record<string, string>;
let fork: Record<string, string>;

beforeAll(async () => {
  const read = async (directory: string): Promise<Record<string, string>> =>
    Object.fromEntries(
      await Promise.all(
        RETAINED.map(async (file) => [file, await readFile(join(directory, file), "utf8")]),
      ),
    );
  vendor = await read(VENDOR);
  fork = await read(FORK);
});

/** fork 保留文件的接线改写：指向上游源码的 import 指回同目录。归一后应能与上游逐行对齐。 */
function wiringNormalized(text: string): string {
  return text.replaceAll(VENDOR_PREFIX, "./");
}

/**
 * 剔除从 `marker` 起的那段（到下一个行首 `}` 的块结束），折叠空行后按行给出；
 * `marker` 不存在时按现状折叠空行——本包有意不复述的块（cordis 声明）走这条路径。
 */
function withoutBlock(text: string, marker: string): string[] {
  const start = text.indexOf(marker);
  if (start < 0) return text.replace(/\n{3,}/g, "\n\n").split("\n");
  const end = text.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`${marker} 的块没有终止`);
  return `${text.slice(0, start)}${text.slice(end + 3)}`.replace(/\n{3,}/g, "\n\n").split("\n");
}

/**
 * 本包有意替换的四行接线：删掉只为 cordis 声明块服务的 `Scoped` / 生命周期类型导入，
 * 改为引入上游包的类型（合并接口只留存一份实例）。
 */
function withoutTypeBridge(lines: string[]): string[] {
  const replaced = new Set([
    "import type {} from '@deepseek-ai/dsh-subagent'",
    "import type { Scoped } from '@deepseek-ai/dsh-scope'",
    "  SubagentRunEndInfo,",
    "  SubagentRunInfo,",
  ]);
  return lines.filter((line) => !replaced.has(line));
}

/**
 * 同步纪律的可执行守护：保留文件漏跟随上游（少一行接线、多一处本地改动）在这里就红。
 * 语义对不对仍要人读上游那份，但「有没有跟随」不用靠眼睛。
 */
describe("薄壳 fork 的接线", () => {
  it("保留文件里的每个相对 import 都指向真实文件", async () => {
    for (const file of RETAINED) {
      const targets = [...fork[file]!.matchAll(/from '(\.[^']*)'/g)].map((match) => match[1]!);

      expect(targets.length, file).toBeGreaterThan(0);
      for (const target of targets) {
        await expect(stat(resolve(FORK, target)), `${file} -> ${target}`).resolves.toBeDefined();
      }
    }
  });

  it("continuation.ts 除 import 接线外与上游逐行一致", () => {
    expect(wiringNormalized(fork["continuation.ts"]!)).toBe(
      wiringNormalized(vendor["continuation.ts"]!),
    );
  });

  it("index.ts 除 import 接线与 cordis 声明块外与上游逐行一致", () => {
    const upstream = withoutTypeBridge(
      withoutBlock(wiringNormalized(vendor["index.ts"]!), CORDIS_DECLARATION),
    );
    const local = withoutTypeBridge(
      withoutBlock(wiringNormalized(fork["index.ts"]!), CORDIS_DECLARATION),
    );

    expect(local).toEqual(upstream);
  });

  it("index.ts 不复述 cordis 合并接口，改为引用上游那一份", () => {
    expect(fork["index.ts"]).not.toContain(CORDIS_DECLARATION);
    expect(fork["index.ts"]).toContain("import type {} from '@deepseek-ai/dsh-subagent'");
  });

  it("continuation-messages.ts 除 withContinuableReturnGuidance 外与上游逐行一致", () => {
    const upstream = withoutBlock(
      wiringNormalized(vendor["continuation-messages.ts"]!),
      RETURN_GUIDANCE,
    );
    const local = withoutBlock(
      wiringNormalized(fork["continuation-messages.ts"]!),
      RETURN_GUIDANCE,
    );

    expect(local).toEqual(upstream);
  });
});

import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Config as UpstreamConfig } from "@deepseek-ai/dsh-agent-instructions";

// 上游 baseline 身份：条目要沿用上游 kind 与 `baseline` / `baselineIdentity`，且身份与上游算出的**逐字相等**
// ——少一样，上游（官方 preset 自己装的那行）就认为基线不存在，于是再注入一条 AGENTS.md。
//
// 上游的 `resolveConfig` / `workspaceBaselineIdentity` / `findProjectRoot` 不在包出口面，所以这里复刻它的形状：
// 默认值取自导出的 `Config` schema，字段名与顺序照 `workspaceBaselineIdentity` 抄；配置基线是 base bundle 给那行的
// `maxBytes: 65536`（其余取 schema 默认）。`baseline.spec.ts` 用上游 `./src/*` 的真函数比对，防这份复刻漂移。
const BASE_MAX_BYTES = 65_536;

// 上游那行的身份基线：与 `packages/bundle/base/cordis.patch.yml` 的 `agent-instructions` 行 config 同源。
export const UPSTREAM_BASELINE_CONFIG = { maxBytes: BASE_MAX_BYTES } as const;

interface BaselineConfig {
  readonly projectRootMarkers: string[];
  readonly maxBytes: number;
  readonly maxSourceBytes: number;
  readonly instructionFileCandidates: string[];
  readonly localInstructionFileCandidates: string[];
}

// schema 调用会把缺省项补齐，所以这里拿到的是上游 schema 的实际默认值。
function resolveBaselineConfig(): BaselineConfig {
  return UpstreamConfig({ ...UPSTREAM_BASELINE_CONFIG }) as unknown as BaselineConfig;
}

// 上游 `findProjectRoot` 的语义：向上找第一个带标记的目录，找不到就用 cwd。
async function projectRootOf(cwd: string, markers: readonly string[]): Promise<string> {
  let current = resolve(cwd);
  for (;;) {
    for (const marker of markers) {
      if (await exists(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// 一个会话的 baseline 身份；cwd 或项目根变了就是另一份身份（上游语义）。
export async function baselineIdentity(cwd: string): Promise<string> {
  const config = resolveBaselineConfig();
  const projectRoot = await projectRootOf(cwd, config.projectRootMarkers);
  // 字段顺序与上游 `workspaceBaselineIdentity` 一致：它比较的是 JSON 字符串，顺序也参与。
  return JSON.stringify({
    projectRoot: relative(cwd, projectRoot),
    projectRootMarkers: config.projectRootMarkers,
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes,
    instructionFileCandidates: config.instructionFileCandidates,
    localInstructionFileCandidates: config.localInstructionFileCandidates,
  });
}

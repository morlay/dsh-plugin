import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Config as UpstreamConfig } from "@deepseek-ai/dsh-agent-instructions";

/**
 * 上游 baseline 身份：`@deepseek-ai/dsh-agent-instructions` 用它在会话 surface 上认领"基线已注入"。
 *
 * 为什么我们要算它：接管那面之后，我们注入的条目**沿用上游 kind**（客户端「上下文注入」标签与按 kind
 * 认领的消费方才认得这是工作区指令），但只沿用一半不够——上游的认领判据是
 * `source.kind === 'agent-instructions' && source.baseline === true` 且 `baselineIdentity` 与它自己算出的
 * identity **逐字相等**。少这两样，上游（官方 preset 自己装的那行）就认为基线不存在，于是**再注入一条**：
 * 同会话切到官方 preset 后会同时存在两条 AGENTS.md——一条是这份正文、一条是上游模板（"Use them as
 * guidance…"），口径互相矛盾，而模型无法把后一条理解成"作废前一条"（两条来源的幂等键不同）。
 *
 * 身份要与上游逐字对齐，但它的 `resolveConfig` / `workspaceBaselineIdentity` / `findProjectRoot` **不在包
 * 出口面**（发布包 `files` 只有 `lib/index.js` 与声明），所以这里复刻它的形状：默认值取自**导出的
 * `Config` schema**（跟随上游默认值演进），字段名与顺序照它的 `workspaceBaselineIdentity` 抄一份；
 * `baseline.spec.ts` 用上游 `./src/*` 出口的真函数比对，防这份复刻悄悄漂移。
 *
 * 配置基线是 base bundle 给那行的 `maxBytes: 65536`（其余取 schema 默认）——与它同源，身份才相等。
 */
const BASE_MAX_BYTES = 65_536;

/** 上游那行的身份基线：与 `packages/bundle/base/cordis.patch.yml` 的 `agent-instructions` 行 config 同源。 */
export const UPSTREAM_BASELINE_CONFIG = { maxBytes: BASE_MAX_BYTES } as const;

interface BaselineConfig {
  readonly projectRootMarkers: string[];
  readonly maxBytes: number;
  readonly maxSourceBytes: number;
  readonly instructionFileCandidates: string[];
  readonly localInstructionFileCandidates: string[];
}

/** schema 调用会把缺省项补齐，所以这里拿到的是上游 schema 的实际默认值。 */
function resolveBaselineConfig(): BaselineConfig {
  return UpstreamConfig({ ...UPSTREAM_BASELINE_CONFIG }) as unknown as BaselineConfig;
}

/** 上游 `findProjectRoot` 的语义：向上找第一个带标记的目录，找不到就用 cwd。 */
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

/** 一个会话的 baseline 身份；cwd 或项目根变了就是另一份身份（上游语义）。 */
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

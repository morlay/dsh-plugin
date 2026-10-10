import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const VENDOR = join(process.cwd(), "vendor/deepseek-harness/packages/subagent/subagent/src");
const FORK = join(process.cwd(), "packages/subagent/dsh-subagent/src");
const VENDOR_PREFIX = "../../../../vendor/deepseek-harness/packages/subagent/subagent/src/";
const CORDIS_DECLARATION = "declare module '@deepseek-ai/cordis' {";
const RETURN_GUIDANCE = "export function withContinuableReturnGuidance(";
const RETAINED = ["index.ts", "manager.ts", "continuation-messages.ts"] as const;

type Retained = (typeof RETAINED)[number];

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

// fork 保留文件的接线改写：指向上游源码的 import 指回同目录。归一后应能与上游逐行对齐。
function wiringNormalized(text: string): string {
  return text.replaceAll(VENDOR_PREFIX, "./");
}

// 剔除从 `marker` 起、到 `until` 那一段的块（缺省到顶格的 `}`：模块级声明与函数）；`marker` 不存在时按现状
// 返回——本包有意不复述的块（cordis 声明）走这条路径。
function withoutBlock(text: string, marker: string, until = "\n}\n"): string {
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const rest = text.slice(start);
  const end = rest.indexOf(until);
  if (end < 0) throw new Error(`${marker} 的块没有终止`);
  return text.slice(0, start) + rest.slice(end + until.length);
}

// 折叠连续空行：块被剔除后留下的空行不该算差异。
function collapsed(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

// 本包有意的偏离：把本地文本还原成上游形状的替换表。`from` 必须命中（本地改回来了、上游又变了，都会在
// 这里红），`drop` 是从 marker 起的整块（新增的函数 / 方法）。一处偏离一条；新加偏离请同时更新
// `../../.agents/designs/20260929-薄壳fork的接管面与保留文件.md` 与对应 ADR。
type Delta =
  | { readonly from: string; readonly to: string }
  | { readonly drop: string; readonly until?: string };

const DELTAS: Record<Retained, readonly Delta[]> = {
  "manager.ts": [
    {
      // 判定函数的接线：多一条上游英文版的 import，并多引一个判定函数。
      from: [
        "import { createAgentMessage, localizedReturnGuidance, withContinuableReturnGuidance, createSettlementMessage } from './continuation-messages.ts'",
        "// 会话不在本部署名单里时用上游那一份（英文）：文案跟着 preset 走，不是整进程只有一份。",
        "import { withContinuableReturnGuidance as upstreamWithContinuableReturnGuidance } from './continuation-messages.ts'",
        "",
      ].join("\n"),
      to: [
        "import { createAgentMessage, withContinuableReturnGuidance, createSettlementMessage } from './continuation-messages.ts'",
        "",
      ].join("\n"),
    },
    {
      // 管理器多收一个读取器：本行配置里的 preset 名单。
      from: "    private readonly maxActiveSubagents: () => number,\n    private readonly localizedGuidancePresets: () => readonly string[],\n",
      to: "    private readonly maxActiveSubagents: () => number,\n",
    },
    {
      // 调用点从"永远是本包的中文"改成"按会话选"。
      from: "            ? this.continuableReturnGuidance(parent, request.prompt)\n",
      to: "            ? withContinuableReturnGuidance(parent.id, request.prompt)\n",
    },
    // 判定方法本身（含它的文档注释；类里的方法以两空格缩进收尾）。
    {
      drop: "  /**\n   * Return guidance for a continuable child's initial task, per session.",
      until: "\n  }\n",
    },
    {
      // 上游那行 `catch (_error: unknown)` 在本仓库的 oxlint 下报未用绑定（上游自己的配置放行）。
      // 为保逐行同形而就地加的一行窄 disable（理由写在注释里）。
      from: "            // oxlint-disable-next-line eslint/no-unused-vars -- 逐行保留上游文件：绑定本就不用\n",
      to: "",
    },
  ],
  "continuation-messages.ts": [
    // 判定函数（含它的文档注释）：本包新增的纯函数。
    {
      drop: "/**\n * Whether this session's return guidance takes this package's Chinese wording.",
    },
    // 中文文案本身：本包唯一改过语义的那一段（见 README 的「保留文件」）。
    { drop: RETURN_GUIDANCE },
  ],
  "index.ts": [
    {
      // 服务面类型声明：判定要读 `ctx.agentPresets`。
      from: "// 服务面声明（`ctx.agentPresets`）由它给：回报指引按会话挂的 preset 选文案。\nimport type {} from '@deepseek-ai/dsh-agent-preset-registry'\n",
      to: "",
    },
    {
      // Config 的那个装配面字段（hidden，不进设置页）。
      from: [
        "  /**",
        "   * Preset ids the Chinese return guidance is restricted to; empty (default) means no restriction.",
        "   *",
        "   * 不配 = 任意 preset 的会话都用本包的中文回报指引（官方四个 shipped preset 也在内，还有还没绑 preset 的会话）。",
        "   * 要反过来只让某几份 preset 用中文，就在这里列出来。装配面，不是用户面——所以不进设置页（`.hidden()`）。",
        "   */",
        "  localizedReturnGuidancePresets: string[]",
        "",
      ].join("\n"),
      to: "",
    },
    {
      from: "    localizedReturnGuidancePresets: z.array(z.string()).default([]).hidden(),\n",
      to: "",
    },
    {
      from: "      }, () => this.config.maxActiveSubagents.get(), () => this.config.localizedReturnGuidancePresets)",
      to: "      }, () => this.config.maxActiveSubagents.get())",
    },
    {
      // 中文委派说明的接线：多一个本包文件的 import（见 `./delegation-context.ts`）。
      from: [
        "import SubagentManager from './manager.ts'",
        "import { installDelegationContext } from './delegation-context.ts'",
        "",
      ].join("\n"),
      to: "import SubagentManager from './manager.ts'\n",
    },
    {
      // 同上，构造器里那一行挂载调用。
      from: [
        "    super(ctx, 'subagents')",
        "    // 模型看到的委派范围说明换成中文（见 `./delegation-context.ts`）。",
        "    installDelegationContext(ctx)",
        "    this.emitLifecycle = createLifecycleEmitter(this.ctx, parent => scopeTarget(this, parent))",
        "",
      ].join("\n"),
      to: [
        "    super(ctx, 'subagents')",
        "    this.emitLifecycle = createLifecycleEmitter(this.ctx, parent => scopeTarget(this, parent))",
        "",
      ].join("\n"),
    },
  ],
};

// 把 fork 文件按偏离表还原成上游形状；`from` / `drop` 没命中就是同步纪律失效，直接抛。
function restored(file: Retained): string {
  let text = wiringNormalized(fork[file]!);
  for (const delta of DELTAS[file]) {
    if ("drop" in delta) {
      if (!text.includes(delta.drop))
        throw new Error(`${file}: 偏离表里的块不在文件里（${delta.drop}）`);
      text =
        delta.until === undefined
          ? withoutBlock(text, delta.drop)
          : withoutBlock(text, delta.drop, delta.until);
      continue;
    }
    if (!text.includes(delta.from))
      throw new Error(`${file}: 偏离表里的片段不在文件里（${delta.from}）`);
    text = text.replaceAll(delta.from, delta.to);
  }
  return collapsed(text);
}

// 本包有意替换的四行接线：删掉只为 cordis 声明块服务的 `Scoped` / 生命周期类型导入，
// 改为引入上游包的类型（合并接口只留存一份实例）。
function withoutTypeBridge(lines: string[]): string[] {
  const replaced = new Set([
    "import type {} from '@deepseek-ai/dsh-subagent'",
    "import type { Scoped } from '@deepseek-ai/dsh-scope'",
    "  SubagentRunEndInfo,",
    "  SubagentRunInfo,",
  ]);
  return lines.filter((line) => !replaced.has(line));
}

// 上游侧要与本地比对的形状：本包不复述的声明块，以及本包整段替换过的实现（本地那份不一样）。
const UPSTREAM_BLOCKS: Record<Retained, readonly string[]> = {
  "index.ts": [CORDIS_DECLARATION],
  "manager.ts": [],
  "continuation-messages.ts": [RETURN_GUIDANCE],
};

// 上游那一份的同一形状。
function upstreamOf(file: Retained): string {
  let text = wiringNormalized(vendor[file]!);
  for (const marker of UPSTREAM_BLOCKS[file]) text = withoutBlock(text, marker);
  return collapsed(text);
}

// 同步纪律的可执行守护：保留文件漏跟随上游（少一行接线、多一处本地改动）在这里就红。
// 语义对不对仍要人读上游那份，但「有没有跟随」不用靠眼睛。
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

  it("continuation-messages.ts 除判定函数与中文文案外与上游逐行一致", () => {
    expect(restored("continuation-messages.ts")).toBe(upstreamOf("continuation-messages.ts"));
  });

  it("manager.ts 除接线与按会话选文案的偏离外与上游逐行一致", () => {
    expect(restored("manager.ts")).toBe(upstreamOf("manager.ts"));
  });

  it("index.ts 除接线、类型桥与装配面配置外与上游逐行一致", () => {
    expect(withoutTypeBridge(restored("index.ts").split("\n"))).toEqual(
      withoutTypeBridge(collapsed(upstreamOf("index.ts")).split("\n")),
    );
  });

  it("index.ts 不复述 cordis 合并接口，改为引用上游那一份", () => {
    expect(fork["index.ts"]).not.toContain(CORDIS_DECLARATION);
    expect(fork["index.ts"]).toContain("import type {} from '@deepseek-ai/dsh-subagent'");
  });
});

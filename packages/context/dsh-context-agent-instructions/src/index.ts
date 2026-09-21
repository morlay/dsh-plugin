import { resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import z from "@deepseek-ai/schemastery";
import type {} from "@morlay/dsh-context-assembler";
import { instructionChain, readInstruction, type InstructionFile } from "./files.ts";

export const name = "context-agent-instructions";

export const inject = ["agents", "contextAssembler"];

export interface Config {
  /** 每级目录的基础指令文件名。 */
  instructionFileCandidates?: string[];
  /** 基础文件之后加载的本地 overlay 名。 */
  localInstructionFileCandidates?: string[];
  /** 单个指令文件的渲染上限（字节）。 */
  maxBytes?: number;
  /** 用户全局指令所在目录（默认 `$DSH_HOME` 或 `~/.dsh`）。 */
  dshHome?: string;
}

export const Config: z<Config> = z.object({
  instructionFileCandidates: z.array(z.string()).default(["AGENTS.md"]),
  localInstructionFileCandidates: z.array(z.string()).default(["AGENTS.local.md"]),
  maxBytes: z.number().default(65536),
  dshHome: z.string().default(process.env["DSH_HOME"] ?? ""),
});

/** 一个会话的指令链：路径集合与它所属的 cwd。 */
const chains = new WeakMap<Agent, { cwd: string; files: InstructionFile[] }>();

/**
 * 工作区指令：一条文件一个规则块（id 为 `agent-instructions:<文件>`），文件变化时正文变、按 id 覆盖。
 *
 * 与上游 `agent-instructions` 的差别：不做 read/write/edit 的 touch 跟踪（本部署的 `AGENTS.md`
 * 几乎不变），只在每步按 `mtime:size` 对账；一份文件一条 id，于是变化只重发变了的那一份。
 */
export function apply(ctx: Context, config: Config): void {
  const options = {
    instructionFileCandidates: config.instructionFileCandidates ?? ["AGENTS.md"],
    localInstructionFileCandidates: config.localInstructionFileCandidates ?? ["AGENTS.local.md"],
    dshHome:
      config.dshHome === undefined || config.dshHome === "" ? defaultDshHome() : config.dshHome,
  };
  const maxBytes = config.maxBytes ?? 65536;
  const cache = new Map<string, { stamp: string; text: string }>();

  const install = async (agent: Agent): Promise<void> => {
    if (chains.has(agent)) return;
    const cwd = agent.session.header.cwd === undefined ? process.cwd() : agent.session.header.cwd;
    const chain = { cwd, files: await instructionChain(cwd, options) };
    chains.set(agent, chain);
    for (const file of chain.files) {
      ctx.contextAssembler.registerRule({
        id: `agent-instructions:${file.display}`,
        text: (target) => {
          const current = chains.get(target);
          if (current === undefined || !current.files.some((entry) => entry.path === file.path))
            return "";
          return readInstruction(file, cache, maxBytes);
        },
      });
    }
  };

  ctx.on("agent/created", ({ agent }) => {
    void install(agent).catch((error: unknown) => {
      ctx.logger.warn(`context-agent-instructions: ${String(error)}`);
    });
  });
  for (const agent of ctx.agents.list()) {
    void install(agent).catch((error: unknown) => {
      ctx.logger.warn(`context-agent-instructions: ${String(error)}`);
    });
  }
}

function defaultDshHome(): string {
  const home = process.env["HOME"] ?? "~";
  return resolve(process.env["DSH_HOME"] ?? `${home}/.dsh`);
}

import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { jsExpr } from "./presets/js-expr.ts";

/**
 * bundle patch 的行清单：**只放全局通用的装配**（与具体模式无关的东西）。
 *
 * 与模式相关的行（工具、注入、用法分组、persona）在 [presets/](./presets/index.ts) 里，由产物给出——
 * patch 作用于全部 preset，放进去就等于强迫 chat 也装。
 *
 * 这里是生成物的真源：`cordis.patch.yml` 由 `renderPatch()` 写出，改动请改这份 TS，
 * 一致性由 `patch.spec.ts` 的断言兜住。
 */

/** 产物里的 `!!js` 表达式在 `with (ctx) { eval(expr) }` 里求值（`ctx.baseUrl` = profile 根）。 */
declare const ctx: { readonly baseUrl: string };

/** 沙箱规则：`rw <path>` 追加工作区之外的可写根，`-- <pattern>` 拒绝访问（读 + 写）。 */
const SANDBOX_ACCESS = [
  "rw /tmp",
  "rw {{ env.XDG_CACHE_HOME }}",
  "rw {{ env.XDG_STATE_HOME }}",
  "rw {{ env.XDG_DATA_HOME }}",
  "r- {{ env.XDG_CONFIG_HOME }}",
  "-- mise.*.toml",
  "-- **/*.pem",
].join("\n");

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    id: "system-prompt",
    // persona 不在这里：它按模式给（presets/persona.ts 的 `persona` 行注册同名 section 遮蔽）。
    config: { includeHarnessIdentity: false, includeRuntimeContext: false },
  },
  {
    id: "agent-presets",
    config: {
      default: "standard",
      includeShippedRoot: false,
      roots: [
        {
          // 产物随包分发，位置只能在运行期解析（`with (ctx) { eval(expr) }` 里只有全局对象稳定可用）。
          path: jsExpr(() =>
            process
              .getBuiltinModule("node:path")
              .join(
                process
                  .getBuiltinModule("node:path")
                  .dirname(
                    process
                      .getBuiltinModule("node:module")
                      .createRequire(ctx.baseUrl)
                      .resolve("@morlay/dsh-preset/package.json"),
                  ),
                "dist/presets",
              ),
          ),
          trust: "system",
        },
      ],
    },
  },
  {
    id: "llm-pi-ai",
    config: {
      providers: {
        ollama: {
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Ollama Cloud",
          api: "openai-completions",
          baseURL: "https://ollama.com/v1",
          reasoning: "high",
          models: [
            {
              id: "deepseek-v4.1-flash",
              name: "DeepSeek V4.1 Flash @ Ollama Cloud",
              contextWindow: 1000000,
              input: ["text", "image"],
              reasoningEfforts: { off: null, low: "low", high: "high", max: "max" },
            },
          ],
        },
      },
    },
  },
  // 这两行由 base bundle 插在 host 层，而 preset 只能覆盖 config、删不掉 host 行——接管它们必须在这里
  // 按 id 禁用：否则 host 的 `tool-skill` 会跟 context-skill-catalog 抢同一个 `skill` 工具，
  // 而 `agent-instructions` 会跟 context-agent-instructions 一起注入工作区指令。
  { id: "agent-instructions", disabled: true },
  { id: "tool-skill", disabled: true },
  { id: "sandbox", disabled: true },
  { id: "fs-sandbox", disabled: true },
  { id: "fs-observation-policy", disabled: true },
  { id: "office-to-pdf", disabled: true },
  { id: "subagent-model-selection-settings", disabled: true },
  {
    insert: [
      {
        id: "sandbox-local",
        name: "@morlay/dsh-sandbox-local",
        config: { access: SANDBOX_ACCESS },
      },
    ],
  },
  {
    // 注入通道：它发布 `ctx.contextAssembler`，而 preset 里的行不允许发布进程全局服务
    // （上游 agent-presets 会拒绝装载），所以它必须住 host 层。
    insert: [{ id: "context-assembler", name: "@morlay/dsh-context-assembler" }],
  },
];

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/preset/dsh-preset/tool/patch.ts 生成，请勿手工编辑
`;

export function renderPatch(): string {
  const body = yaml.dump([...PATCH_ROWS], {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${HEADER}${body}`;
}

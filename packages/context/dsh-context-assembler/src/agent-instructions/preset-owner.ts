/**
 * 「这个会话的 preset 行清单里装了上游 `agent-instructions` 吗」——装了就让位，这一面归 preset。
 *
 * 为什么要有这条判据：官方 web-app 把 `agent-instructions` 从 host 平面设成 `disabled`、交给 preset 的行清单
 * （[`web-app/cordis.patch.yml:546`](../../../vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml) 与
 * `presets/*.patch.yml`）。本部署保留官方 preset 整套，于是**同一个会话**里 preset 平面的上游行与 host 平面的
 * 我们都会注入：一步里两条 AGENTS.md，而模型无法把后一条理解成"作废前一条"（两条的幂等键不同）。
 *
 * 方向：**我们让位**，不是上游认领我们。上游 `agent-instructions` 的认领判据只看它**看得见**的东西
 * （本步 claimed 的消息 + 会话 surface：
 * [`agent-instructions/src/index.ts:46-63`](../../../vendor/deepseek-harness/packages/context/agent-instructions/src/index.ts)），
 * 第 1 步两侧都在各自算注入，谁也算不出对方那一条，所以"由上游认领"救不了首步的重复
 * （`baselineIdentity` 那份身份管的是另一件事，见 [`baseline.ts`](./baseline.ts)）。
 *
 * 判据取**行清单里的模块名**而不是行 id：行 id 在 preset 的 `config.plugins` 里是自由的，模块名才是"哪一面的
 * 提供者"。`enabled === true` 表示这一行在这个代际真的装着；`'conditional'`（`!!js` 读不出）按"没装"处理——
 * 读不出就不敢让位，宁可我们提供。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
// 只用它的类型：`ctx.agentPresets` 的形状来自上游注册表的声明合并，装不上时这里读到 undefined。
import type {} from "@deepseek-ai/dsh-agent-preset-registry";

/** 上游那一行的模块名：与 `presets/*.patch.yml` 里写的一字不差。 */
const UPSTREAM_MODULE = "@deepseek-ai/dsh-agent-instructions";

/** 会话 → 它当前的 preset。preset 变了（空白窗口里换 preset）就整份重算。 */
const decided = new WeakMap<Agent, { preset: string; owns: Promise<boolean> }>();

/**
 * 该会话的 preset 自己提供了工作区指令这一面吗。
 * @param ctx - 能解析到注册表的上下文（能力自己的 apply ctx）。
 * @param agent - 要判的会话。
 * @returns 行清单里有上游那一行且它是启用的。
 */
export function presetOwnsInstructions(ctx: Context, agent: Agent): Promise<boolean> {
  const registry = registryOf(ctx);
  if (registry === undefined) return Promise.resolve(false);
  const preset = registry.composedPreset(agent.ctx);
  // 没挂 preset（子代理还没 join、没装注册表的部署、测试里的假 standing scope）：这一面归我们。
  if (preset === undefined) return Promise.resolve(false);

  const cached = decided.get(agent);
  if (cached?.preset === preset) return cached.owns;

  const owns = registry
    .compositionInventory()
    .then((inventory) =>
      inventory.some(
        (composition) =>
          composition.id === preset &&
          composition.rows.some(
            (row) => row.moduleName === UPSTREAM_MODULE && row.enabled === true,
          ),
      ),
    )
    // 读不出来就当我们提供：缺内容比重复更糟，而"读不出来"只可能来自坏掉的注册表。
    .catch(() => false);
  decided.set(agent, { preset, owns });
  return owns;
}

/** 注册表可能压根没装（没有 preset 的部署形态）；`ctx.get` 在不提供时读到 undefined。 */
function registryOf(ctx: Context): Context["agentPresets"] | undefined {
  try {
    return ctx.get("agentPresets") as Context["agentPresets"] | undefined;
  } catch {
    return undefined;
  }
}

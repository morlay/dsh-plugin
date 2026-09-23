/**
 * 本包作为 **bundle** 的行清单，也是 preset 引用它的那一份真源。
 *
 * 两种采用方式共用这份清单：
 *
 * 1. `dsh.profile.bundles` 直接列出本包（`cordis.patch.yml` 由它渲染）→ 通道与四个注入方装在
 *    host 平面：整份部署共享一套注入；
 * 2. 由某个 preset 引用（`@morlay/dsh-agent-preset` 的 coding / chat 就是这么做的）→ 同一批行住进
 *    那个 preset 的 `isolate` 组，注册表因此不越界。
 *
 * 组必须整组搬：通道服务由 `isolate` 隔离，注入方要跟它同住一个 realm 才解析得到它；组外单放一行，
 * 它 `inject` 的 `contextAssembler` 永远等不到（行停在 waiting，不报错）。
 */

/** 组装出口（包根）就是那个"按 config 装能力"的插件。 */
export const CONTEXT_PACKAGE = "@morlay/dsh-context-assembler";

/** 通道组的 id：`isolate` 的 label 按服务名给，与组 id 无关。 */
export const CONTEXT_CHANNEL_GROUP_ID = "context-assembler-channel";

/** 一行 plugin entry（本模块只描述形状，类型由消费方自己那份行类型决定）。 */
export interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** 一个 `cordis:group` 行：`isolate` 让它内部的 `contextAssembler` 不越出这棵子树。 */
export interface ContextGroupRow {
  readonly id: string;
  readonly name: string;
  readonly group: true;
  readonly isolate: Readonly<Record<string, true>>;
  readonly config: readonly ContextRow[];
}

/**
 * context 组那一行：包的主出口是**组装插件**——按 config 决定装哪些能力、各带什么参数，所以装配面
 * 只有这一行，组成与各能力的 config 都归包内（缺省即完整的一套；`chat` 用它裁剪）。
 */
export function contextChannel(config?: Readonly<Record<string, unknown>>): ContextRow {
  return { id: "context-assembler", name: CONTEXT_PACKAGE, ...(config === undefined ? {} : { config }) };
}

/**
 * 模式开关那一行：`scope` 出口按 preset 配（工具白名单、instruction 总开关、动态快照开关）。
 *
 * 它不住在通道的隔离组里——通道与注入方都在 profile 平面装一次，这一行只按模式收口（它 `inject`
 * `contextAssembler`，`ctx.get("contextAssembler")` 在 agent 子树里可达）。
 */
export function scopeRow(config?: Readonly<Record<string, unknown>>): {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
} {
  return {
    id: "context-scope",
    name: "@morlay/dsh-context-assembler/scope",
    ...(config === undefined ? {} : { config }),
  };
}

/** 关住 context 那一行：通道服务因此留在引用方的 realm 里，别的 preset 拿不到它。 */
export function channelGroup(rows: readonly ContextRow[]): ContextGroupRow {
  return {
    id: CONTEXT_CHANNEL_GROUP_ID,
    name: "cordis:group",
    group: true,
    isolate: { contextAssembler: true },
    config: [...rows],
  };
}

/**
 * 本包作为独立 bundle 装配时的行清单：完整一套（不带 config），装在 host 平面。
 *
 * 与 preset 引用不同的是 realm：这里装出来的是**整份部署共享**的一份通道，官方 preset 的会话同样
 * 会拿到这套注入。要"只有我们的模式吃"，就用第二种采用方式（让 preset 引用这份清单），别同时用两种。
 */
export const PATCH_ROWS: readonly ContextGroupRow[] = [
  // profile 平面装一次：通道 + 两个注入方；`scope` 不在这里——它是模式的开关，由 preset 装 `scopeRow()`。
  channelGroup([contextChannel({ capabilities: ["assembler", "agent-instructions", "skill-catalog"] })]),
];

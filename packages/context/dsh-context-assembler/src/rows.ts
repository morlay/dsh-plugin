/**
 * 本包作为 **bundle** 的行清单：`dsh.profile.bundles` 列出本包时由它渲染成 `cordis.patch.yml`。
 *
 * 通道装在 host 平面，整份部署共享一套注入。**不做隔离**——工具说明
 * （`@morlay/dsh-agent-toolkit/guidance`，在别的包里）与 skill 目录这类消费者都在别的行上
 * `inject` 它，隔离会把它们挡在组外（行停在 waiting，不报错）。
 *
 * 本包自己的 bundle 只装通道（`PATCH_ROWS`）。模式的收口是另一行（`scopeRow()`），它由
 * [`@morlay/dsh-session-mode`](../../../profile/dsh-session-mode/README.md) 的 patch 与模式定义一起装——
 * 那一行的 config 就是模式清单。
 */

/** 组装出口（包根）就是那个"按 config 装能力"的插件。 */
export const CONTEXT_PACKAGE = "@morlay/dsh-context-assembler";

/** 一行 plugin entry（本模块只描述形状，类型由消费方自己那份行类型决定）。 */
export interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * 通道那一行：包的主出口是**组装插件**——按 config 决定装哪些能力、各带什么参数，所以装配面
 * 只有这一行，组成与各能力的 config 都归包内（缺省即完整的一套；`chat` 用它裁剪）。
 */
export function contextChannel(config?: Readonly<Record<string, unknown>>): ContextRow {
  return {
    id: "context-assembler",
    name: CONTEXT_PACKAGE,
    ...(config === undefined ? {} : { config }),
  };
}

/**
 * 模式收口那一行：`scope` 出口按 `ctx.sessionModes` 的模式定义收口（工具白名单、instruction 总开关、
 * 动态快照开关）。
 *
 * 行 id 用全名 `context-assembler-scope`：它的搭档是同一份装配里的 `context-assembler`（通道），两个 id 放在
 * 一起才看得出这一行属于哪个包、做什么——`context-scope` 那种短名会被误当成 `ctx.contextScope` 之类的服务。
 *
 * 行本身**不带 config**：装哪些模式、每个模式收什么，都由 `session-mode` 行的 `config.modes` 决定，
 * 这一行只把它落到会话上（`inject` `sessionModes`，由
 * [`@morlay/dsh-session-mode`](../../../profile/dsh-session-mode/README.md) 的 patch 插一行）。
 */
export function scopeRow(): ContextRow {
  return {
    id: "context-assembler-scope",
    name: "@morlay/dsh-context-assembler/scope",
  };
}

/**
 * bundle patch 的行清单：只有通道一行（模式收口那一行归 `session-mode` 的 patch 装）。
 *
 * 形态是 `insert`：这些行由本包提供给 host 平面。写成 `- id: x` 那种"改已有行"的形态时，装配期找不到
 * 目标行（只 warn 后跳过），通道根本没装上，引用它的行停在 waiting。
 */
export const PATCH_ROWS: readonly { readonly insert: readonly ContextRow[] }[] = [
  {
    insert: [
      contextChannel({ capabilities: ["assembler", "agent-instructions", "skill-catalog"] }),
    ],
  },
];

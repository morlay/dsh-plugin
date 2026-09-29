// 本包那一行的真源（`contextChannel()`）：`dsh.profile.bundles` 里列的是 bundle（本部署是
// `@morlay/session-mode-profile`），它 import 本模块拼装，构建期由 devkit 的 `bundlePatch` 写出包根那份
// `cordis.patch.yml`。消费方把它包成 `insert` 层：写成"改已有行"的形态时，装配期找不到目标行（只 warn 后跳过），
// 引用它的行停在 waiting。
//
// 通道装在 host 平面、整份部署共享一套注入，**不做隔离**：消费者（`@morlay/dsh-tool-guidance` 的包根）住在
// 别的包里、在别的行上 `inject` 它，隔离会把它们挡在组外（行停在 waiting，不报错）。

// 通道那一行的插件 name：包根（`@morlay/dsh-context-assembler`）就是通道本体。
export const CONTEXT_PACKAGE = "@morlay/dsh-context-assembler";

// 一行 plugin entry（本模块只描述形状，类型由消费方自己那份行类型决定）。
export interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

// 通道那一行：**不带 config**——包根即通道本体，`keep` / `suppress` / `replace` 的缺省就是本部署要的那一份。
export function contextChannel(): ContextRow {
  return {
    id: "context-assembler",
    name: CONTEXT_PACKAGE,
  };
}

// 本包作为能力包发布的**装配数据**：只剩工具说明那一行（`tool-guidance`，host 平面）。
//
// 功能行清单（工具 / 命令 / 压缩 / 计划模式 / 委派）**不由本包持有**：它们归会话挂着的 agent preset（官方
// shipped preset），本部署不再自建一份——取舍见
// `packages/bundles/session-mode-profile/.agents/adrs/20260929-不再持有行清单.md`。汉化与用法分组的数据在
// `./guidance/`，运行时在包根 `./index.ts`。

// 工具说明那一行（汉化精简 + 用法分组）：实现与数据在本包里，行本身也归本包（host 平面——它往
// 通道这个 host 单例注册被丢弃的 section、往官方 skill 注册表注册按需的组，装进 preset realm 会与 host
// 那份互相顶掉）。
export function toolGuidanceRow(config?: Readonly<Record<string, unknown>>): {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
} {
  return {
    id: "tool-guidance",
    name: "@morlay/dsh-tool-guidance",
    ...(config === undefined ? {} : { config }),
  };
}

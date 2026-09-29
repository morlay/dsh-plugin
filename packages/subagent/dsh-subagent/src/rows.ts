// 本包作为能力包发布的**装配数据**：行本身在部署那一层装（`packages/bundles/session-mode-profile`
// 引用它渲染 patch）。
//
// 接管方式是**按官方行 id 复用**：Loader 对同 id 的条目复用同一个 Entry、后者替换入口 options，所以行
// id 与 settings namespace 都还是 `subagent`（官方设置卡照常可用），换掉的只是实现包。顺序前提：本包排在
// `@deepseek-ai/dsh-base` 之后；模型白名单服务行仍留官方卡片第二段。

// 一行装配条目：与 `cordis.patch.yml` 的顶层结构同形。
export interface PatchRow {
  readonly id?: string;
  readonly disabled?: boolean;
  readonly insert?: readonly RowEntry[];
}

// `insert` 里的一个条目。
export interface RowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface SubagentRowsOptions {
  // 把中文回报指引**限制**到这些 preset（本行 `config.localizedReturnGuidancePresets`）。
  // 不传就是不限：任意 preset（含官方四个 shipped）与还没绑 preset 的会话都用我们的中文文案。
  readonly localizedReturnGuidancePresets?: readonly string[];
}

// 服务接管的装配行：占官方 `subagent` 那个行 id。
export function subagentRows(options: SubagentRowsOptions = {}): readonly PatchRow[] {
  const presets = options.localizedReturnGuidancePresets;
  return [
    {
      insert: [
        {
          id: "subagent",
          name: "@morlay/dsh-subagent",
          ...(presets === undefined
            ? {}
            : { config: { localizedReturnGuidancePresets: [...presets] } }),
        },
      ],
    },
  ];
}

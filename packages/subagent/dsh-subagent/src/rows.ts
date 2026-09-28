/**
 * 本包作为能力包发布的**装配数据**：行本身在部署那一层装
 * （`packages/bundles/session-mode-profile` 引用它渲染 patch）。
 *
 * 接管方式是**按官方行 id 复用**，不是"禁掉官方行再插一行自己的"：Loader 对同 id 的条目复用同一个 Entry、
 * 后者替换入口 options（`EntryGroup.create` 的 `create: true`），所以行 id 与 settings namespace（namespace
 * 就是行 id）都还是 `subagent`——官方设置卡 `ui-settings-subagent` 读得到那两个 namespace，照常可用；换掉的
 * 只是实现包。顺序前提：本包排在 `@deepseek-ai/dsh-base` 之后（app 的 `dsh.profile.bundles` 已如此）。
 *
 * 模型白名单服务行（`subagent-model-selection-settings`）留给官方卡片第二段，本包不动它。
 */

/** 一行装配条目：与 `cordis.patch.yml` 的顶层结构同形。 */
export interface PatchRow {
  readonly id?: string;
  readonly disabled?: boolean;
  readonly insert?: readonly RowEntry[];
}

/** `insert` 里的一个条目。 */
export interface RowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface SubagentRowsOptions {
  /**
   * 哪些 preset 的会话用本包的中文回报指引（本行 `config.localizedReturnGuidancePresets`）。
   * 由装配给：它才知道自己注册的那份 preset 叫什么；不传即一律上游英文。
   */
  readonly localizedReturnGuidancePresets?: readonly string[];
}

/** 服务接管的装配行：占官方 `subagent` 那个行 id。 */
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

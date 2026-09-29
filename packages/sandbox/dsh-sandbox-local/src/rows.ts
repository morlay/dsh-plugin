// 本包作为能力包发布的**装配数据**：行本身在部署那一层装（`packages/bundles/sandbox-profile` 引用它
// 渲染 patch）。官方 `sandbox` 与 `fs-sandbox` 两个服务只能有一份实现，所以那两行禁掉、换成本包那一行；
// `config.access` 的值由部署那层给（schema 默认是空规则）。

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

// 沙箱替换的装配行：禁官方两行 + 插本包一行（值由部署那层按 id 覆盖）。
export function sandboxRows(): readonly PatchRow[] {
  return [
    { id: "sandbox", disabled: true },
    { id: "fs-sandbox", disabled: true },
    { insert: [{ id: "sandbox-local", name: "@morlay/dsh-sandbox-local" }] },
  ];
}

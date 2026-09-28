/**
 * 本包作为能力包发布的**装配数据**：行本身在部署那一层装
 * （`packages/bundles/ollama-provider-profile` 引用它渲染 patch；那里同时给 `web.searchProvider` 与 key 引用）。
 *
 * 注册行必须在 host 平面只装一次——同一个 provider id 注册两份会撞 `WEB_DUPLICATE_PROVIDER`。
 */

/** 一行装配条目：与 `cordis.patch.yml` 的顶层结构同形。 */
export interface PatchRow {
  readonly id?: string;
  readonly insert?: readonly RowEntry[];
}

/** `insert` 里的一个条目。 */
export interface RowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** 搜索后端的注册行（config 的值由部署那层按 id 覆盖）。 */
export function webSearchRows(): readonly PatchRow[] {
  return [{ insert: [{ id: "web-search-ollama", name: "@morlay/dsh-web-search-ollama" }] }];
}

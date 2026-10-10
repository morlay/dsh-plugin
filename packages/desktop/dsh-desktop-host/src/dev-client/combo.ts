export const COMBO_PATH = "/plugins/";

const CLIENT_RESOURCE = /^(?<id>.+)\/client\.js$/u;

const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/u;

export function comboEntryIds(requestUrl: string): string[] | undefined {
  const query = requestUrl.slice(requestUrl.indexOf("?") + 1);
  if (!query.startsWith("?")) return undefined;
  const list = query.slice(1).split("&", 1)[0] ?? "";
  if (list === "") return undefined;
  const ids: string[] = [];
  for (const resource of list.split(",")) {
    const matched = CLIENT_RESOURCE.exec(resource);
    const id = matched?.groups?.id;
    if (id === undefined || id === "") return undefined;
    ids.push(id);
  }
  return ids;
}

/** 单包资源路径（`/<id>/client.js`，不含 combo 的 `??` 前缀）；chunk 与其它路径返回 undefined。 */
export function singleEntryId(requestUrl: string): string | undefined {
  const path = requestUrl.split("?", 1)[0] ?? "";
  if (!path.startsWith(COMBO_PATH)) return undefined;
  const matched = CLIENT_RESOURCE.exec(path.slice(COMBO_PATH.length));
  const id = matched?.groups?.id;
  return id === undefined || id === "" ? undefined : id;
}

export function stripSourceMapTrailer(code: string): string {
  return code.replace(SOURCE_MAP_TRAILER, "\n");
}

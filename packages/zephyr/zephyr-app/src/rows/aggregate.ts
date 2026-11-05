// dev 形态的聚合名单（`AppEnv.aggregate`，glob）：命中的包**不算开发模块**，走按包联邦产物。
/** 一条 glob（只支持 `*`）→ 正则。 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[/\\^$+?.()|[\]{}]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

/** `name` 是否命中聚合名单（命中 = 不逐文件走 vite）。 */
export function isAggregated(name: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

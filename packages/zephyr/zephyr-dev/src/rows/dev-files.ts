// dev 形态的**当文件名单**（`Federation.dev.include`，glob）：命中的包走 vite 逐文件（改它要 HMR），其余一律 prebundle。
//
// 判据是**正向白名单**而不是"谁不准当文件"：上游（`@deepseek-ai/*`）的 client 之间有循环 re-export，
// 落进 vite 的逐文件 ESM 服务会报 `Detected cycle while resolving name`，整页起不来；而漏配一个该改的
// 包只是少了 HMR。漏配与错配的代价差这么远，名单就该默认只放我们自己的包。
/** 一条 glob（只支持 `*`）→ 正则。 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[/\\^$+?.()|[\]{}]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

/** `name` 是否命中当文件名单（命中 = 逐文件走 vite，不 prebundle）。 */
export function isDevFile(name: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

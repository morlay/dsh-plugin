/**
 * host 半：本包没有 host 侧行为，空 `apply` 只为让这一行出现在 profile 的 Loader 里。
 *
 * 页面在 client 半（`exports["./client"]`，按 `dsh.client` 声明加载）：自动注册 `plugins.row.config`、
 * 按 schema 渲染字段、并把字段级自定义输入开放成 chain 槽。
 */

/** host 插件体：本行无 host 侧行为。 */
export function apply(): void {}

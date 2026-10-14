/**
 * 壳产物里要**内联**的包（而不是留在产物外）。
 *
 * 壳跑在 `app.asar` 里，它的解析面只有产物自身 + Electron 提供的东西：留在外面的裸引用会变成
 * `ERR_MODULE_NOT_FOUND`。所以这几类必须内联——
 * - `@morlay/dsh-desktop-host`：壳直接用它（wire 协议、paths、webServer 的替身）；
 * - 快捷键桥的原生侧要用上游的「设备偏好单写者」与原子写，它们同样进不了 asar 的解析面。
 *
 * 这份名单是**一个事实**：壳自己的构建（[`tsdown.config.ts`](../../tsdown.config.ts)）与 `@local/dshdev` 的
 * 装配（`prepareShell`）都用它——两边不一致的话，装配出来的产物就会缺依赖。
 */
export const SHELL_INLINE_PACKAGES: readonly string[] = [
  "@morlay/dsh-desktop-host",
  "@deepseek-ai/dsh-client-shortcuts",
  "@deepseek-ai/dsh-atomic-write",
  "@deepseek-ai/dsh-util-values",
  "@deepseek-ai/dsh-util-crypto",
];

// CSS 的模块声明：vite 侧由 `?inline` / 样式注入处理，tsc 侧只需要"这些扩展名合法"。
// 删掉 `zephyr-ui` 时带走了它的 `css-modules.d.ts`，于是 `just lint` 的 tsc 检查（TS2882）
// 对 `import "./base.css"` 报"找不到声明"。
declare module "*.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

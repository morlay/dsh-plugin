// 本包 client 半的组件样式是上游那套 CSS Modules（`*.module.css`，lightningcss 在构建期编译并内联）：
// bundler 解析得动，TS 需要这份 ambient 声明把它定成「有一个 class 映射的模块」。
declare module "*.module.css" {
  const classes: Readonly<Record<string, string | undefined>>;
  export default classes;
}

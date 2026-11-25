// ui 层（`*.spec.dom.ts` / `*.spec.dom.tsx`，happy-dom）的环境补齐。
//
// happy-dom **没实现** `document.compatMode`（所有原型上都没有这个属性，读到 `undefined`），而 KaTeX 在
// **模块加载时**据此判定「quirks mode」：不但打一条 `Warning: KaTeX doesn't work in quirks mode`
// （每份 katex 副本一条，全量 36 个 ui 用例文件各两条、共 72 条 stderr），还会把它自己的 `render`
// 换成直接抛 `ParseError` 的版本——这些用例里的公式根本没渲染，只是在打日志。
//
// 真浏览器带 doctype 时 `compatMode` 就是 `CSS1Compat`：补上这个缺失的只读属性，让环境与浏览器一致。
// **不要去静音 KaTeX 的告警**（那会把「渲染真的坏了」一起吞掉），也不要动 `vendor/**`。
//
// 定义在**当前 document 的原型**上（happy-dom 给的是 `HTMLDocument`，不是 `Document`），
// 且必须早于任何 katex 的 import——setupFiles 正是这个时机。
Object.defineProperty(Object.getPrototypeOf(document), "compatMode", {
  get: () => "CSS1Compat",
  configurable: true,
});

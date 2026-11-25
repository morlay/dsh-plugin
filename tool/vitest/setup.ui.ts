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
// UI 用例**不打真网络**：给一个立刻以 503 结算的 `fetch`。
//
// 为什么必须换掉：happy-dom 的 `location.origin` 是 `http://localhost:3000`，而客户端链的 unary
// 传输（`muxTransport` 的 `callUnary`）就是 `fetch(location.origin + "/api/…")`——UI 用例装的是真清单，
// 于是**打了真网络**。本机 3000 上碰巧有别的东西在听、回 401：断言照样过，请求却留在途里。
//
// 到文件结束、happy-dom 拆窗口时，它把还在途的请求 abort 掉（`Fetch.onAsyncTaskManagerAbort`）。
// 那些 AbortError 不属于任何用例：vitest 记成未捕获错误，落在文件收尾之前就让**整个文件**失败——
// 症状正是「连跑时换着文件出现、单跑必绿」（拆窗口的时刻正好压在断言之后，慢一点就翻过来）。
//
// 换成立刻结算的 503 之后：调用方走的是**既有的**「响应不 ok」那条分支（与今天拿到 401 完全同形），
// 既不留 pending、也不依赖本机端口上有没有东西在听。
const OFFLINE_FETCH_STATUS = 503;

globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new Response(JSON.stringify({ error: "UI 用例不打真网络", url }), {
    status: OFFLINE_FETCH_STATUS,
    headers: { "content-type": "application/json" },
  });
};

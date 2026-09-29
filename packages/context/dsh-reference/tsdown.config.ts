import { defineCordisPluginConfig } from "@local/devkit";

// host 半插件（挂 `agent/pre-step` 展开引用），没有 client 入口，所以只产 ESM。
//
// 引用解析的 home 是 `@morlay/dsh-client-ui-primitives` 的 `reference.ts`（`ADR-引用的统一解析与渲染转换`，
// 在 `ui-conversation-message-actions` 的 `.agents/adrs/`）——那份包同时带 client 样式层与 React 渲染，所以这里
// 把用到的解析实现**内联进产物**，发布清单里不出现它。
export default defineCordisPluginConfig({
  inline: ["@morlay/dsh-client-ui-primitives"],
});

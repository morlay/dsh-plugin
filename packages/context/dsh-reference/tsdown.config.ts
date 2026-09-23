import { defineCordisPluginConfig } from "@local/devkit";

/**
 * host 半插件（挂 `agent/pre-step` 展开引用），没有 client 入口，所以只产 ESM。
 *
 * 引用解析复用 `@morlay/dsh-client-ui-primitives` 的 `reference.ts`（唯一 home，见
 * [ADR-20260917-引用的统一解析与渲染转换](../../../session/ui-conversation-message-actions/.agents/adrs/20260917-引用的统一解析与渲染转换.md)），
 * 但那份包同时带 client 样式层与 React 渲染 → 这里把用到的解析实现**内联进产物**，
 * 发布清单里不出现它：一条 host 能力不该拖着 client 包。
 */
export default defineCordisPluginConfig({
  inline: ["@morlay/dsh-client-ui-primitives"],
});

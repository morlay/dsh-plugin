// agent 的**测试支撑**（`@morlay/dsh-agent/testing`）：headless 层的最小清单 + 两份通用替身。
//
// 这里**只放 headless**：root + 契约能跑起来的那一层。要 wire（`./server` 的端点）或浏览器面的
// 测试不属于这里——那些属于装配面（`@morlay/zephyr-app/testing` 或应用入口的 `__tests__`）。
//
// 契约的**空壳 fake 不在这里造**：`AgentDirectory` 这类端口有十几个成员，写空壳等于把契约抄一遍。
export { headlessAgentProviders } from "./providers.ts";
export { FakeAppEnv } from "./fake-app-env.ts";
export { FakeLlmAdapter } from "./fake-llm-adapter.ts";

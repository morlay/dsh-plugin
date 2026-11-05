// 「preset 平面」的装配原语：上游 cordis 的 `Loader` 与 `Group` 插件。
//
// 与本目录其它转出（`newTestContext`）同一条理由：扩展包的测试要装真 Loader 来验证「行清单归哪份
// preset」，但不该为此直接依赖 `@deepseek-ai/cordis-plugin-*`。
export { default as PresetGroup } from "@deepseek-ai/cordis-plugin-group";
export { default as PresetLoader } from "@deepseek-ai/cordis-plugin-loader";

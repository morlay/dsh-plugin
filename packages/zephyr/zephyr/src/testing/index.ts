// 框架内部的**测试面**：业务包的测试要断言「装配清单里谁依赖谁」「令牌指向谁」。
//
// 这些是 DI 核心的内部表示（不是装配 API），所以不进包门面；测试要读它们就走这里。
// 旧写法 `@morlay/zephyr/src/token.ts`（开发面深引）与此同源——新代码走这个出口。
export { injectPlaceholderOf, kFace, tokenMetaOf } from "../token.ts";

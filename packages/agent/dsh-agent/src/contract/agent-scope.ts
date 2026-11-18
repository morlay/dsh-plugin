// per-agent 装配的声明面：Provider 自己声明装配 scope，装配器按 scope 分派。
//
// 这里只转出**声明与令牌**，定义在 `../agent-scope.ts`：
// - `@AgentScoped()`：外部**唯一**能表达「这个 Provider 装进每个 agent 的 scope」的方式（它是
//   `@Injectable({ scope })` 的别名，没有额外行为；不写 scope 就是应用根）；
// - `AgentScopedRows`：装行能力的令牌（agent 创建处注入它，每个 agent 调一次）。
//
// 分类键是 symbol，且**不导出**。
export { AgentScoped, AgentScopedRows } from "../agent-scope.ts";

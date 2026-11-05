# @morlay/dsh-agent-instruction

把仓库里的 agent 指令按字节上限注入系统提示词。

## 用法

```ts
import { AgentInstructionModule } from "@morlay/dsh-agent-instruction";

providers: [...AgentInstructionModule.withConfig()];
```

`maxBytes` 是上游必填项，本模块固定给 64 KiB。

## 事实

- 这是**行**不是模块：`AgentInstruction` 把上游 `@deepseek-ai/dsh-agent-instructions` 的插件接管进本行作用域，依赖 `SessionProjectionStore` 与 `WorkingDirectory` 由装配面交出。
- 没有自有契约面：消费方是上游 `systemPrompt` 一侧，本仓没有按令牌注入它的地方。
- 技能的前端实现在 [`@morlay/dsh-skill/ui`](../dsh-skill/README.md)。

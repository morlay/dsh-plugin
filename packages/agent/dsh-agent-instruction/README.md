# @morlay/dsh-agent-instruction

把仓库里的 agent 指令按字节上限注入系统提示词。

## 用法

```ts
import { provideAgentInstruction } from "@morlay/dsh-agent-instruction";

...provideAgentInstruction(),
```

## 事实

- 这是**行**不是模块：`AgentInstruction` 把上游 `@deepseek-ai/dsh-agent-instructions` 的插件接管进本行作用域，`deps` 是 `SessionProjectionStore` 与 `WorkingDirectory`。
- `maxBytes` 是上游必填项，本行固定给 64 KiB。
- 没有自有契约面：消费方是上游 `systemPrompt` 一侧，本仓没有按令牌注入它的地方。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

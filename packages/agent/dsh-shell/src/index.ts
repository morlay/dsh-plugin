// shell 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./shell-env.service.ts";
export * from "./subprocess.service.ts";
export * from "./terminal.service.ts";
// 装配函数在 `./server`（本包有 ui 面：root 不出 `provideXxx`）。

// 上游 `@deepseek-ai/dsh-shell-env` **一个符号都不透传**：本包已出自己的三件契约（`ShellEnv` /
// `ShellExecutor` / `Subprocess`）、两个默认实现（`ShellEnvDefault` / `SubprocessDefault`）与装配函数
// （`provideShell` / `provideTerminal`），消费方要的都在这里面。上游独有的 `Config` / `ShellEnvRegistry` /
// `apply` / `inject` / `name` 没有消费方。

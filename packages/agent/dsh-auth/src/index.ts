export * from "./contract/index.ts";
// 认证：只支持 API_KEY（不接上游的 deepseek-account 平台账号）。
export * from "./authorization.service.ts";
export * from "./credentials.service.ts";


// 上游门面：消费方不直接引 `@deepseek-ai/dsh-credentials`，从本包取。

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-credentials`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-credentials";

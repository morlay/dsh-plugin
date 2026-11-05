export * from "./contract/index.ts";
// 认证：只支持 API_KEY（不接上游的 deepseek-account 平台账号）。
export * from "./authorization.service.ts";
export * from "./credentials.service.ts";

// 上游 `@deepseek-ai/dsh-credentials` **一个符号都不透传**：本包只出自己的契约（`Authorization`）与两个
// 默认实现（`AuthorizationDefault` / `CredentialsDefault`）。上游那些名字（`CredentialProvider` /
// `parseCredentialKey` / `credentialRef` …）本仓没有消费方；将来要用的人直接引上游包，
// 别再把整包挂到本包门面上。

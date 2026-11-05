// attachment 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
//
// `AttachmentError` 随契约一起转出：契约里的 `isAttachmentError` 是**类型谓词**，判它需要这个类，
// 消费方（含测试假件）不该为此直接依赖上游包。
export { AttachmentError } from "@deepseek-ai/dsh-attachment";
export * from "./contract/index.ts";
export * from "./attachment-store.service.ts";
export * from "./attachment.provide.ts";

// 上游的**实现类** `LocalFileSystem`：本域能力包根转出它，消费方（configurable-sandbox 的行）继承它做围栏。
//
// 它是实现不是契约，所以放包根、不进 `./contract`；`Config` 在契约面（`FileSystemConfig`）。
export { default as LocalFileSystem } from "@deepseek-ai/dsh-fs-local";

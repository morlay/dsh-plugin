// 上游的**实现类** `LocalSandboxProvider` 与它的 `Config`：本域能力包根转出。
//
// 消费方（configurable-sandbox 的行）继承它做受限执行；实现不进 `./contract`，契约只出 `Sandbox` 端口。
export {
  default as LocalSandboxProvider,
  type Config as LocalSandboxConfig,
} from "@deepseek-ai/dsh-sandbox-local";

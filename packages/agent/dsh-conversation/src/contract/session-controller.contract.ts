// 合同已搬到 `@morlay/dsh-session/endpoint`（它是端点合同：引用上游 api 层的 `ISessions`）。
//
// 这里保留 re-export：本包内部的相对 import 与下游的 `@morlay/dsh-conversation/contract` 公开面都不动。
export {
  SessionScope,
  SessionView,
  SessionCatalogState,
  SessionCatalog,
  SessionRetainHandle,
  SessionController,
  SessionControllerCovered,
} from "@morlay/dsh-session/endpoint";

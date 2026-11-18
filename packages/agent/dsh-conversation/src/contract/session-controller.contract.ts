// 会话目录合同已上移到 `@morlay/dsh-session/contract`（见那边的文件头注释：它是会话域的读面）。
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
} from "@morlay/dsh-session/contract";

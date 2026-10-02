// 配置页要的"全局目录"（工具名 / 技能名）走一条**本包自己开的 Remote 面**：工具清单只在 host（`ctx.tools`），技能面
// 在客户端只有按会话的 `remote.skills.list({ sessionId })`——而这个配置页是全局设置面，没有会话。官方没有现成的 api，
// 所以这条面由本包自己注册：host 半提供服务（[`./catalog.ts`](./catalog.ts) 的 `@Remote('list')`），client 半把下面这份
// 贡献 mount 上去（[`./client/index.ts`](./client/index.ts)）。
//
// 本文件只有类型与那份贡献常量（不带 host 依赖），两半都能 import。

import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";

// 线上命名空间与它的 Cordis 服务键：客户端 mount 之后按 `remote.<这个名字>` 取服务。
export const CATALOG_NS = "sessionModeCatalog";

// 部署里可用的工具名与技能名。
export interface SessionModeCatalogValue {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
}

// 这条 Remote 面的读侧。
export interface SessionModeCatalogRemote {
  list: () => Promise<RemoteResult<SessionModeCatalogValue>>;
}

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    sessionModeCatalog: SessionModeCatalogRemote;
  }
}

// 客户端挂载用的贡献：`result` 用 `src-json`（结果就是普通 JSON，不走严格解码）。
export const SESSION_MODE_CATALOG_REMOTE: TypertRemoteContribution = {
  package: "@morlay/dsh-session-mode",
  descriptors: [
    {
      id: "@morlay/dsh-session-mode#sessionModeCatalog/list",
      service: CATALOG_NS,
      namespace: CATALOG_NS,
      method: "list",
      implementation: "remoteExportList",
      invocation: { kind: "direct" },
      parameters: [],
      result: { mode: "src-json" },
    },
  ],
};

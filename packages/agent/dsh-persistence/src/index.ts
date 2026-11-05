// persistence 域的包根：json 后端行 + 装配模块。
//
// 没有 `contract/`：后端行的令牌就是适配类自身（它登记进上游 `Storage` hub，契约在
// `@morlay/dsh-storage`）。所以这里的依赖方向是**单向**的：`dsh-persistence` → `dsh-storage`，
// 存储包不认识任何具体后端。
export * from "./storage-json.service.ts";
export * from "./persistence.provide.ts";

// session-mode 的 **RPC 面**（`@morlay/session-mode/endpoint`）：组契约 + 两端共用的形状。
//
// 与包根的分界：包根是 host 契约与默认实现；这里只放两端都要读的声明，浏览器半因此不必引包根。
export * from "./mode-config.ts";
export * from "./session-mode-shapes.ts";
export * from "./session-mode-endpoint.ts";

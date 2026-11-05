// env-tool 域的包根：只有四行（shell / 文件 / 检索 / 工作目录的工具），契约面是 `@morlay/dsh-agent` 的 `ToolRegistry`。
export * from "./tool-bash.service.ts";
export * from "./tool-fs.service.ts";
export * from "./tool-fs-search.service.ts";
export * from "./tool-working-directory.service.ts";
export * from "./env-tool.provide.ts";

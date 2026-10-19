// skill 域的包根：契约 + root 行（注册表 / 文件系统来源）+ 装配模块。
// **server 实现不走这里**：`@morlay/dsh-skill/server`（适配行、端点行、server 模块）。
export * from "./contract/index.ts";
export * from "./endpoint/skill-endpoint.ts";
export * from "./skill.service.ts";
export * from "./filesystem.service.ts";

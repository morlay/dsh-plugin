// job 域的契约面（`@morlay/dsh-job/contract`）：进程内的端口，不涉及 remote。
export * from "./job-registry.contract.ts";
// 浏览器侧的数据面（`ctx.jobs`）：宿主那份注册表同名不同树，两者不会出现在同一个 ctx 上。
export * from "./jobs.contract.ts";

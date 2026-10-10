// 本包测试辅助：client 面的测试要用宿主面的目录服务与它的远程面常量（跨面的引用走出口，不走相对路径）。
export { SessionModeCatalog } from "./catalog.ts";
export { CATALOG_NS, SESSION_MODE_CATALOG_REMOTE } from "./catalog-remote.ts";

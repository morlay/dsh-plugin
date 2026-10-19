// root 出口：只导出核心消费 API。适配/兼容层（fromCordis / toCordis / jsExpr）在 `@morlay/zephyr/compat`。
export * from "./injection.ts";
export * from "./token.ts";
export * from "./api-group.ts";
export * from "./provider.ts";
export {
  Module,
  moduleFileOf,
  moduleMetaOf,
  without,
  flattenProviders,
  providersOfModule,
  expandModule,
  dedupeProviders,
  isModuleClass,
  isModuleRef,
  plannedTokensOf,
  moduleImportsOf,
} from "./module.ts";
export type { ModuleMeta } from "./module.ts";
export { bindServiceTable, resolveService, resolveServiceByTokenName, resolveServiceName, serviceNamesOf, serviceTableOf, isPlannedToken } from "./service-table.ts";
export * from "./attach.ts";
export * from "./bootstrap.ts";
export * from "./logger.ts";

// 构建面：入口从包的 `exports` 推导，用 rolldown 打 host 面；清单由 `writeBuildManifest` 写回。
// 声明是构建的一部分（全仓声明树由 dts-prepare 的进程锁生成一次，再按入口聚合），运行时零依赖 tsdown。
export { buildPackage, planOf, type BuildArtifacts, type BuildPlan } from "./compile.ts";
export {
  writeBuildManifest,
  writePackageManifest,
  type BundleRow,
  type PackageExportsOptions,
} from "./package-exports.ts";
export { prebundleDependency, type PrebundledDependency } from "./prebundle.ts";
export { compileCssModule, compileGlobalCss, compileStyleModule, cssInlinePlugins } from "./css.ts";
export {
  bundleClientFactory,
  bundleClientLibrary,
  clientBundleSpec,
  clientAssetPlugin,
  clientEntryPlugin,
  clientRowExternals,
  ASSET_MIME,
  CLIENT_ENTRY,
  INLINE_SAFE,
  isClientExternal,
} from "./cordis-client.ts";
export type {
  ClientBundleSpec,
  ClientFactoryOptions,
  CordisClientOptions,
} from "./cordis-client.ts";

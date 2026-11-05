// cordis 插件包的打包机制：一个 tsdown 配置入口（`cordisPlugin` / `buildCordisConfig`）+ 它用到的
// client 入口处理、出口清单写回、样式与资产内联、依赖内外联规则。定位与接入状态见本包 `README.md`。
export {
  buildCordisConfig,
  cordisPlugin,
  isInlinedPackage,
  isLocalPackage,
  LOCAL_PACKAGE_PREFIX,
  type CordisPluginOptions,
} from "./cordis-host.ts";
export {
  packageExportsHook,
  writePackageManifest,
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

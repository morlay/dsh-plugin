export { defineCordisPluginConfig, isLocalPackage, LOCAL_PACKAGE_PREFIX } from "./cordis-host.ts";
export { packageExportsHook, type PackageExportsOptions } from "./package-exports.ts";
export {
  bundleClientFactory,
  clientBundleSpec,
  clientEntryPlugin,
  clientRowExternals,
  CLIENT_ENTRY,
  isClientExternal,
} from "./cordis-client.ts";
export type { ClientBundleSpec, ClientFactoryOptions } from "./cordis-client.ts";
export type { CordisClientOptions } from "./cordis-client.ts";

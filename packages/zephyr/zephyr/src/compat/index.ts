// 适配层：把上游 cordis 插件与 zephyr 的消费面互转。只有写适配行与行入口的代码需要它。
export {
  kProvider,
  providerOfPlugin,
  toCordis,
  type CordisPluginEntry,
  type ToCordisOptions,
} from "./to-cordis.ts";
export { fromCordis, type AdaptedRow } from "./from-cordis.ts";
export { kAdapted, kFace } from "../token.ts";

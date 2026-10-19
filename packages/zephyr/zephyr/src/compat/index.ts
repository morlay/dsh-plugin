// 兼容/适配层：把上游 cordis 插件与 zephyr 的消费面互转。
// 只有「写适配行」的代码需要它；普通消费方（Provider / Module / inject）不应引入这一层。
export {
  awaitCordisServiceOfType,
  fromCordis,
  fromCordisService,
  resolveProvider,
  serviceOfType,
} from "./from-cordis.ts";
export type { AdaptedClass, AdaptedOptions, DepsOf } from "./from-cordis.ts";
export { toCordis } from "./to-cordis.ts";
export type { ToCordisOptions } from "./to-cordis.ts";
export { jsExpr } from "./js-expr.ts";

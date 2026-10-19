// 兼容/适配层：把上游 cordis 插件与 zephyr 的消费面互转。
// 只有「写适配行」的代码需要它；普通消费方（provider 清单 / inject）不应引入这一层。
// 适配行的对外入口只有 `fromCordis(...)`：`fromCordisService`（上游服务类 → 强类型令牌）是实现细节，
// 不出这个出口——写适配行时用契约形态表达，别把上游服务类当令牌用。
export {
  awaitCordisServiceOfType,
  fromCordis,
  resolveProvider,
  serviceOfType,
} from "./from-cordis.ts";
export type { AdaptedClass, AdaptedOptions, DepsOf } from "./from-cordis.ts";
export { toCordis } from "./to-cordis.ts";
export type { ToCordisOptions } from "./to-cordis.ts";
export { jsExpr } from "./js-expr.ts";

// 适配层：把上游 cordis 插件兑成 zephyr 的消费面。只有写适配行与行入口的代码需要它。
export { kProvider, providerOfPlugin } from "../token.ts";
export { fromCordis, type AdaptedClass, type AdaptedRow } from "./from-cordis.ts";
export { kAdapted, kFace } from "@morlay/zephyr";

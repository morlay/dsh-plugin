import { provide } from "@morlay/zephyr";
import { TypertDefault } from "./typert.service.ts";

/**
 * 类型化 Remote 的**注册表**（`typert`）。
 *
 * 分发者（`typertGateway`）不在这里：它就是上游 `api/gateway` 的 `TypertGatewayService`
 * （`super(ctx, 'typertGateway')`），由 `provideApiGateway()` 装上。
 * 那个实现自带 descriptor 解析、lookup 解析与错误码映射——比自己写的薄版本正确得多。
 */
export const provideTypert = provide([TypertDefault]);

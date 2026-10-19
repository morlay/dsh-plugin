import { provide } from "@morlay/zephyr";
import { TokenMeterDefault } from "../token-meter.service.ts";

/** 令牌计量：按会话累计 token 用量。 */
export const provideTokenMeter = provide([TokenMeterDefault]);

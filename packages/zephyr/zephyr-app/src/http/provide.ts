import { provide } from "@morlay/zephyr";
import { ServeDefault } from "./serve.service.ts";

// `ServeDefault extends WebServe`：令牌按原型链取契约（`resolveToken`），不需要 useClass/Factory。
export const provideHttp = provide([ServeDefault]);

import { provide } from "@morlay/zephyr";
import { SessionTitleDefault } from "../session-title.service.ts";

/** 标题服务：默认预算在实现类里，装配面可 `configure` 覆盖。 */
export const provideSessionTitle = provide([SessionTitleDefault]);

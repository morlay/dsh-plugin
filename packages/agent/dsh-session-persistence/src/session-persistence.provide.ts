import { provide } from "@morlay/zephyr";
import { SessionPersistenceDefault } from "./session-persistence.service.ts";

/** 会话落盘：自己实现（不转发上游插件），默认清单只有这一个实现。 */
export const provideSessionPersistence = provide([SessionPersistenceDefault]);

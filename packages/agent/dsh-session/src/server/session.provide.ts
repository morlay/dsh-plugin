import { provide } from "@morlay/zephyr";
import { SessionStoreDefault } from "../session.service.ts";

/** 会话存储（真 store）：`get` / `list` 都从这里来。 */
export const provideSession = provide([SessionStoreDefault]);

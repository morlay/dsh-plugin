import { provide } from "@morlay/zephyr";
import { SessionProjectionCacheDefault } from "../session-projection-cache.service.ts";

/** 投影缓存：写穿节流的默认值在实现类里，装配面可 `configure` 覆盖。 */
export const provideSessionProjectionCache = provide([SessionProjectionCacheDefault]);

import { provide } from "@morlay/zephyr";
import { RemoteAccessDefault } from "./remote-access.service.ts";

/** 访问控制的读面（我们自己实现，不依赖上游那份读 `globalThis` 的实现）。 */
export const provideAccess = provide([RemoteAccessDefault]);

// 投影读面的装配：会话域自己装（`ProjectionsDefault` 读的是本域的 `session/control` 流）。
import { provide } from "@morlay/zephyr";
import { ProjectionsDefault } from "./projections.service.ts";

/**
 * 投影读面的装配：装一次，之后本域所有消费方都从 `Projections` 读宿主算出来的值。
 *
 * 排在 `provideClientRemote()` 之后（它要 `remote`）与 `provideClientConnection()` 之后（它要 `connection`）。
 * @returns provider 清单。
 */
export const provideProjections = provide([ProjectionsDefault]);

import { provide } from "@morlay/zephyr";
import { ProjectionsDefault } from "./projections.service.ts";

/**
 * 投影读面的装配：装一次，之后所有领域都从 `Projections` 读宿主算出来的值。
 *
 * 排在 `provideClientRemote()` 之后（它要 `remote`）与 `provideClientConnection()` 之后（它要 `connection`）。
 */
export const provideProjections = provide([ProjectionsDefault]);

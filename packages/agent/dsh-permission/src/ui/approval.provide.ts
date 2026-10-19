import { provide } from "@morlay/zephyr";
import { UiApproval } from "./approval.service.ts";

/** approval 的浏览器半（与 permission 同属本包的 `./ui` 出口）。 */
export const provideApproval = provide([UiApproval]);

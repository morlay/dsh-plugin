import { toCordis } from "@morlay/zephyr/compat";
import { Reference } from "./reference.service.ts";

// dsh 行入口（`@morlay/dsh-reference/cordis-register`）。
export const referenceRow = toCordis(Reference, { name: "reference" });

export default referenceRow;

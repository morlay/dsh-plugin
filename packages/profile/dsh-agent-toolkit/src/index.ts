/**
 * 本包的实体是 `rows` 出口（功能行清单）与包根的 `cordis.patch.yml`；包根没有可装配的插件行为，
 * 这里只把清单转出来，方便 `import { TOOLKIT_ROWS } from "@morlay/dsh-agent-toolkit"`。
 */
export * from "./rows.ts";

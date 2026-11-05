import { provide } from "@morlay/zephyr";
import { ResourcesContribution } from "./resources.contribution.ts";
import { ResourcesDefault } from "./resources.service.ts";

/** 资源模型：服务（`Resources`）与它的 UI 贡献（`resource` keyed hook）各一行。 */
export const provideResources = provide([ResourcesDefault, ResourcesContribution]);

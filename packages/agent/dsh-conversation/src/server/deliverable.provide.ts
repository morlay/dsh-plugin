import { provide } from "@morlay/zephyr";
import { DeliverablesHostDefault, WorkspaceChangesDefault } from "../deliverable.service.ts";

// 一个面一个函数：数据源（`workspaceChanges`）在前，路由在后（路由的 `onInit` 要读它）。
export const provideDeliverables = provide([WorkspaceChangesDefault, DeliverablesHostDefault]);

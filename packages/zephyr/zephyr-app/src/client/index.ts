// 前端面的**装配入口**：只导出装配模块与跨包要用的契约。
//
// 服务的实现（`slots.service`/`ui-renderer.service`/`resources.service`…）**不从这里出**：
// 它们深引上游源码（`.../src/client/*.tsx`），只在装配内部用；入口导出它们会让消费方把整条
// 实现链（含深引）拖进自己的模块图——在非 vite 环境（如 vitest）里会直接解析失败。
export * from "./provide.ts";
export * from "./bootstrap-client.ts";
export * from "../connection/contract.ts";
export { provideClientConnection } from "./connection/provide.ts";
export { ClientConnectionDefault } from "./connection/connection.service.ts";
export * from "../remote/remote.contract.ts";
export * from "./remote/session-remote.ts";
export * from "./remote/remote-transport.ts";
export * from "./remote/provide.ts";
export * from "./remote/session-remote.client.ts";
// `@Remote`（方法装饰器）**不在这里导出**：`Remote` 这个名字是上游装载面契约。
// 需要它的业务包从子路径拿：`@morlay/zephyr-app/client/remote`。
export { RemoteGroup, remoteGroupNameOf } from "../remote/decorators.ts";
export { Slot, SlotContribution, applySlotDeclaration, slotDeclarationOf } from "./renderer/slot.decorator.ts";
export { SlotProvider, SlotView, SlotViewBase, slotViewOf } from "./renderer/slot-view.tsx";
export { View, ViewScope, instanceSourceOf, positionNameOf, viewRegistrationOf } from "./renderer/view.tsx";
export * from "./renderer/slots.contract.ts";
export * from "./renderer/provide.ts";
export * from "./renderer/ui-renderer.contract.ts";
export * from "./resources/resources.contract.ts";
export * from "./remote-access/remote-access.contract.ts";
export * from "./locale/locale.contract.ts";
export { FileDragDefault } from "./file-drag/file-drag.service.ts";
export * from "./settings/config-forms.contract.ts";
export * from "./shortcuts/shortcuts.contract.ts";
export * from "./theme/theme.contract.ts";
export { provideTheme } from "./theme/provide.ts";
export { ConfigFormsInMemory } from "./settings/config-forms.fake.ts";
export * from "./layout/layout.contract.ts";
export { SidebarRightTabs } from "./sidebar-right-tabs.ts";
export { SettingsSchema } from "./settings-schema.ts";
// `localStorage` / `sessionStorage` 的代理（同步内存真源 + IndexedDB 异步落盘）。
export { installStorageShim, type StorageShim, type StorageShimResult } from "./storage-shim.ts";

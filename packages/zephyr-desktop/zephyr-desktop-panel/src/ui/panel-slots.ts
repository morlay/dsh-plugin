// 本包占的位置：右栏面板那一页（keyed 座位）。
//
// **位置由声明方拥有**：`sidebar.right.pane.tab` 已由右栏的 tab 机制声明（`@SlotProvider` 只能声明一次，
// 再声明一次就是「service 已被注册」——真实现场：页面装配直接失败）。本包只是贡献一个 key 的视图，
// 所以走运行时的 `Slots.registerDynamic`，不碰声明。
/** 右栏面板那一页的 id（keyed 位置的 key）：包名是天然的唯一值。 */
export const PANEL_ID = "@morlay/zephyr-desktop-panel";

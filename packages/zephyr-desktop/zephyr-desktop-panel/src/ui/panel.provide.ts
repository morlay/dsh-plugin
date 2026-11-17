// 面板的浏览器半（client 面）装配：tab 类型先注册，正文按同一个 key 挂到 `sidebar.right.pane.tab` 上。
import { provide } from "@morlay/zephyr";
import { DesktopPanelTab } from "./panel-tab.ts";
import { DesktopPanelView } from "./panel.view.tsx";

export const provideDesktopPanelUi = provide([DesktopPanelTab, DesktopPanelView]);

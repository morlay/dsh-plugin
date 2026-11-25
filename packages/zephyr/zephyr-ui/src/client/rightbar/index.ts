// 右栏：容器座位、正文座位、标签座位与角位展开按钮。
//
// 组件只吃 props（数据与动作都由座位行给）；样式只在本包。
export {
  Rightbar,
  type RightbarLabels,
  type RightbarProps,
  type RightbarRenderSlot,
  type RightbarTab,
  type RightbarView,
} from "./rightbar.tsx";
export { RightbarPaneTab, type RightbarPaneTabProps } from "./rightbar-pane-tab.tsx";
export { RightbarTabTitle, type RightbarTabTitleProps } from "./rightbar-tab-title.tsx";
export {
  RightbarExpand,
  type RightbarExpandProps,
  type RightbarExpandView,
} from "./rightbar-expand.tsx";

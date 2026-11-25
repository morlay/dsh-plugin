// 右栏的展示件：外壳、正文位、标签 chip、guide 空态。
//
// 只吃 props（数据与动作由容器装配行给）；样式只在本包。
export {
  Rightbar,
  type RightbarLabels,
  type RightbarProps,
  type RightbarRenderSlot,
  type RightbarTab,
  type RightbarView,
} from "./rightbar.tsx";
export { RightbarPaneTab, type RightbarPaneTabProps } from "./rightbar-pane-tab.tsx";
export { RightbarGuide, type RightbarGuideProps } from "./rightbar-guide.tsx";
export { RightbarTabTitle, type RightbarTabTitleProps } from "./rightbar-tab-title.tsx";

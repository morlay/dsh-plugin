// 右栏的展示件：外壳、正文位、标签 chip、guide 空态。
//
// 只吃 props，且 props 只来自两处：注册行 `inject` 给的、渲染器/父在 `renderSlot` 时给的。
export {
  Rightbar,
  type RightbarLabels,
  type RightbarProps,
  type RightbarRenderSlot,
  type RightbarSessionProvider,
} from "./rightbar.tsx";
export { RightbarPaneTab, type RightbarPaneTabProps } from "./rightbar-pane-tab.tsx";
export { RightbarGuide, type RightbarGuideProps } from "./rightbar-guide.tsx";
export { RightbarTabTitle, type RightbarTabTitleProps } from "./rightbar-tab-title.tsx";

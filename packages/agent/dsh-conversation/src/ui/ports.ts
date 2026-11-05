// 会话界面**消费**的跨行服务端口：令牌的 home 在框架层（`@morlay/zephyr-app/client`）——
// 别的域（技能、模型选择、命令）同样要用它们，放这里就会让它们反向依赖对话聚合层。
export { SidebarRight, SidebarRightTabs } from "@morlay/zephyr-app/client";

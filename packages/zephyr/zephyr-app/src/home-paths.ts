// 框架侧的 home 路径工具（上游 `@deepseek-ai/dsh-home-paths`）：两端共用，不拖宿主实现。
//
// 上游那个包只服务「把 dsh 的 home 目录算出来」这一件事，归框架域（`zephyr-app`）；
// 消费方（session-mode / configurable-sandbox）从这里取，不再直连上游包。
export { dshHomePath } from "@deepseek-ai/dsh-home-paths";

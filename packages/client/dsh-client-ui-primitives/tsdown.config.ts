import { defineCordisPluginConfig } from "@local/devkit";

// 普通库（不是插件包）：默认出口是**浏览器组件**（`src/client/index.ts`），host 侧用得着的引用解析
// 走子路径 `./reference`。没有 `./client` 出口——共享库的产物由消费方打进自己的 client 产物
// （打包器的判据正是"有没有 `exports["./client"]`"，所以这里不需要 `dsh.client.inline` 那种标记）。
export default defineCordisPluginConfig({
  entries: {
    index: "./src/client/index.ts",
    reference: "./src/index.ts",
  },
});

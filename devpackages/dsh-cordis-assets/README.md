# @morlay/dsh-cordis-assets

cordis client 产物的**资产与样式**处理，两个出口：

- `@morlay/dsh-cordis-assets/assets`：扩展名 → mime、`?raw` 内联、资产按策略内联成 `data:` 或落成独立文件；
- `@morlay/dsh-cordis-assets/styles`：CSS 内联与作用域化（`lightningcss`）。

**为什么独立成包**：同一份实现被两条链共用——**构建期**（tsdown 插件打包 client 产物）与**运行期**
（`@morlay/dsh-client-modules` 在宿主里现场把联邦产物打给浏览器）。分开就会"两条链对资产内联还是落文件
各说各话"。它曾经住在构建期插件（`@local/tsdown-plugin-cordis`）里，于是运行期的包被迫依赖一个工具包；
现在方向反过来：**工具依赖它**。

# 客户端 bundle 单文件与 shadow 渲染替换

状态：已采纳

背景：浏览器半的产物经 `__ModuleLoader__.load` 手递，而 client-modules 只服务 / 加载 `client.js` 这一个
文件名（产物落 `dist/client.cjs`）；上游 chat 节点的渲染由上游渲染器把持，插件面的改造入口只有「整格
shadow keyed slot」。

**决定**

- **渲染替换**：`conversation.chat.node` 的 `user` / `steering` 两个 key 以 `priority: -1` 重新注册（最低
  优先级渲染，shadow 上游默认注册），编辑 / 重试按钮只挂在 user 消息上；其余 key 沿用上游渲染器。
- **list 槽同法覆盖**：`conversation.composer.dock` 的 `stats` id 以 `priority: -1` 覆盖官方同 id 行，承载
  我们的 token 口径与 `data-composer-stats`（语义见
  [设计 20260917-编排层操作语义](../designs/20260917-编排层操作语义.md) 的「浏览器半」）。
- **单文件构建约束**：devkit 的 client 入口插件（`clientEntryPlugin` + `isClientExternal`）把平台 baseline
  （react / cordis / store / slots / primitives）与 `@deepseek-ai/*` client 插件行保持 external（由模块表
  提供；内联会把别的插件的 `__ModuleLoader__.load` 嵌进来导致 duplicate factory），契约层
  （`dsh-session` / `dsh-llm` / `dsh-util-*` 等无模块表条目的包）与第三方依赖全部内联。

**考虑过的选项**

- **替换全部聊天节点 key**：会与上游渲染器大面积 shadow、重复维护；实际只需 `user` / `steering`（编辑 /
  重试入口所在）。
- **多文件 bundle**：client-modules 只服务 / 加载 `client.js`，多文件需要修改上游加载机制（违反红线）。

**后果**

- 操作后重建窗口（探测 `binding.resync()` → `sessions.refresh()`）与单文件约束的现状细节见
  [设计 20260917-编排层操作语义](../designs/20260917-编排层操作语义.md) 的「浏览器半」。
- CSS Modules 经 lightningcss 内联 + `<style data-plugin>` 注入。

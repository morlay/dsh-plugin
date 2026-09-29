# @morlay/dsh-subagent

上游 `@deepseek-ai/dsh-subagent` 的**薄壳 fork**：接管官方 `subagent` 行，只改一件事——continuable 子代理首条任务后面的**回报指引**换成中文，且只在「会话挂着本部署那份 preset」时用，其余会话（官方 shipped preset、没挂 preset 的会话）保持上游那套。

## 用法

行数据在本包 `./rows` 出口（`subagentRows()`），由 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md) 展开并给 `localizedReturnGuidancePresets`。**按官方行 id 复用**，所以服务名（`ctx.subagents`）、providers、settings namespace 与官方设置卡都不变，限额字段（`maxDepth` / `maxActiveSubagents`）仍在那张卡上——本包没有 client 半。

保留文件、偏离登记与结构性约束见[设计 薄壳fork的接管面与保留文件](./.agents/designs/20260929-薄壳fork的接管面与保留文件.md)。

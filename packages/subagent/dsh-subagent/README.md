# @morlay/dsh-subagent

上游 `@deepseek-ai/dsh-subagent` 的**薄壳 fork**：接管官方 `subagent` 行，改两处文案——

1. 子代理首条任务后面的**回报指引**换成中文，**默认对任意会话生效**（官方四个 shipped preset、还没绑
   preset 的会话都在内）；只有在装配面给了 `localizedReturnGuidancePresets` 名单时才收窄成「只有名单里的 preset
   用中文」，其余会话保持上游那套。有指引这件事本身跟上游一致：只在"通知父智能体"的派发上加（上游 0.2.1-alpha.2
   起由 `delivery` 区分，`delivery: 'caller'` 那条不给指引）；
2. 子代理自己的**委派范围说明**（运行时上下文 `subagent:delegation`）换成中文，两条派发路径（`delivery` 为
   `parent` / `caller`）一起覆盖。

## 用法

行数据在本包 `./rows` 出口（`subagentRows()`），由 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md) 展开——它**不传** `localizedReturnGuidancePresets`（不配名单 = 不限 preset），传了才收窄。**按官方行 id 复用**，所以服务名（`ctx.subagents`）、providers、settings namespace 与官方设置卡都不变，限额字段（`maxDepth` / `maxActiveSubagents`）仍在那张卡上——本包没有 client 半。

保留文件、偏离登记与结构性约束见[设计 薄壳fork的接管面与保留文件](./.agents/designs/20260929-薄壳fork的接管面与保留文件.md)。

## 委派范围说明怎么换的

`subagent:delegation` 由上游在**子代理自己的 agent 作用域**上注册，两条常规接管手法都不通：同层重复注册同名 context
会抛错；fork `child-agent.ts` 只影响本包 `manager.ts` 那条路径、对外部 backend 的子代理无效。所以本包改的是**装配
结果**——`system-prompt/assemble` 瀑布里把该名字那条的文本换成中文（`src/delegation-context.ts`），在该次装配内生效。

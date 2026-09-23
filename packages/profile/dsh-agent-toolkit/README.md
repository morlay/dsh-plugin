# @morlay/dsh-agent-toolkit

**agent 功能行清单**：shell、文件、任务、skill 发现、goal、压缩、委派与工作流、问答、todo、联网、
交付物——就是"一个编码 Agent 该有哪些能力"那一份清单。

它不注册服务、不带行为，实体是 `rows` 出口与包根的 `cordis.patch.yml`：

- **preset 引用它**（[`@morlay/dsh-agent-preset`](../dsh-agent-preset/README.md) 的 coding / chat 就是这么做的）：
  行住进那个 preset 的子树，只有那个模式才有这些能力；
- **profile 列出它**（`dsh.profile.bundles`）：`cordis.patch.yml` 把整套行插到 host 平面，整份部署
  （含官方 preset）都能看到这些工具。

两种采用方式共用 `src/rows.ts` 这一份真源，别同时用。

## 用法

preset 侧（模式只决定"要不要"，不罗列能力）：

```ts
import { TOOLKIT_ROWS } from "@morlay/dsh-agent-toolkit/rows";

export const STANDARD_ROWS = [personaRow, ...TOOLKIT_ROWS, ...modeSwitches];
```

bundle 侧：把它加进 app 的 `dsh.profile.bundles` 即可，行由 `cordis.patch.yml` 提供。

引用的都是上游 `@deepseek-ai/dsh-*` 能力包（本包不发布它们的实现，只发布"清单 + 行 id"）。

## 边界

| 归这里                                   | 不归这里                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| 工具 / 命令 / 压缩 / 委派 / 工作流的功能行 | 提示词（persona）与能力开关（scope 白名单、capabilities 裁剪）→ agent-preset |
| 行的 id、config 与 isolate 组            | 注入通道那套 → [dsh-context-assembler](../../context/dsh-context-assembler/README.md) |
|                                          | 部署级配置值（llm route、搜索后端、沙箱规则）→ [dsh-profile](../dsh-profile/README.md) |

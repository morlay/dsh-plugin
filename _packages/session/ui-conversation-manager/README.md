# @morlay/ui-conversation-manager

「对话管理」全局面板页（**浏览器半**）：`sidebar.panellist` 的 nav 行 + `main` keyed 面板（与官方
ui-plugin-manager 同一种注册方式）。一层 Tabs 在**会话**与**统计**之间切换：会话视图做全量会话的搜索、分页与
归档 / 取消归档 / 导出 / 删除（确认弹窗），并带导入为新会话与孤儿数据 GC；统计视图给出全部对话的 token 用量。

## 用法

页面是 profile 的一行（由 `@morlay/better-session` 的 patch 插入），装好即在侧栏出现「对话管理」。它不新增
host 面，只读既有服务与路由：

| 动作         | 接缝                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 列表与标题   | `POST /api/morlay/v1/session/rows`（`@morlay/session-rdb`：完整语料 + 标题 + 最后活动时间 + 工作区归属；搜索 / 子代理过滤 / 分页都在后端） |
| 归档         | `ctx.uiWorkspace.archiveSession`（上游 ui-workspace，未归档行提供）                                                                        |
| 取消归档     | `ctx.uiWorkspace.unarchiveSession`（上游 ui-workspace，已归档行提供）                                                                      |
| 导出         | `POST /api/morlay/v1/session/export`（`@morlay/session-rdb`，直接下载 zip）                                                                |
| 删除         | `POST /api/morlay/v1/session/delete`（`@morlay/session-rdb`，仅已归档行可用）                                                              |
| 导入为新会话 | `POST /api/morlay/v1/session/import`（`@morlay/session-rdb`，不带 `sessionId` = 新建会话）                                                 |
| 清理孤儿数据 | `POST /api/morlay/v1/session/gc`（停 agent → 回收孤儿 subagent 会话 → 回收孤儿事件行 → VACUUM；执行期间阻塞界面）                          |
| 用量统计     | `POST /api/morlay/v1/session/usage`（`@morlay/session-rdb` 读专用用量表聚合；进入统计视图时拉一次，维度切换本地折叠，范围切换重新请求）    |

归档 / 取消归档 / 删除 / 导入 / GC 成功后重拉会话行；host 拒绝（未归档 / 正在使用 / 不存在）时按错误码给出可读
文案。删除只对已归档会话开放；子代理派生会话（`origin: 'subagent'`）默认不列，勾选「显示子代理会话」即真
全量。

统计视图的三个维度口径：**总览**给「全部」与「其中子代理」两行；**按模型**把人类与子代理合并成同一模型
一行（同一模型不拆行）；**按会话**按用量降序取前 20，行上标出子代理会话，并可切「只看子代理会话」——子
代理会话单个用量小，混排时会被行数上限挤掉。

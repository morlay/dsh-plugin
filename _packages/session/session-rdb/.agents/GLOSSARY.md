# 会话持久化面（session-rdb）

本包自己的词：会话事件日志落库后的**坐标、行形状与并发语义**——只有实现层（本包与它的消费测试）用它，
跨包的会话编辑词汇（会话、轮次、闭合边界、重放、fork 等）在根
[`.agents/GLOSSARY.md`](../../../../.agents/GLOSSARY.md)，边界表见
[`.agents/GLOSSARY-MAP.md`](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

### 血统与日志

**canonical log**：
会话的持久化事件日志（与存储内容一致，ignorable 事件同样在其中）；核心
读者凭信封跳过 ignorable 事件。
_避免使用_：主日志、持久化日志

**lineage（血统）**：
会话的祖先链：`parentSession` 指向父会话，继承的前缀长度记在会话头里
（v0 / v1 header 是显式长度，v2 起由 log 内的 `session/end-seed` 推导）。
_避免使用_：家谱、祖先链

### 坐标模型

**稠密 seq（dense seq）**：
持久化坐标（`f_sequence`）：写路径零转换，事件按落库顺序连续编号、无空洞。
_避免使用_：持久化 seq

**上游 seq（original seq）**：
事件产生时的 seq（含不入库事件留下的空洞）——持久化坐标即稠密 seq，v3 起
不存映射列。
_避免使用_：原始 seq、逻辑 seq

**瞬时事件（transient event）**：
上游 seq 中不落库的事件留下的空洞来源；写路径不按类型过滤（落库事件
与内存事件一致），坐标由稠密 seq 承担。
_避免使用_：流式事件、chunk 事件

**桥接行（bridge row）**：
`t_session_events` 行：会话专属信息（`f_sequence`、surface op 元数据）挂在
桥接行，事件实体本身不含会话信息。
_避免使用_：关联行、映射行

**事件行复用（event row reuse）**：
fork 派生会话的桥接行直接引用父会话已存在的事件行，不复制事件行。
_避免使用_：事件共享、行复用

**torn tail**：
崩溃留下的未闭合尾部——读打开只标记 `tornFrom`，物理删除推迟到下一次写
append（截断后重写 head）。
_避免使用_：损坏尾部、残尾

**孤儿事件行（orphan event row）**：
无任何桥接行引用的事件行（rewind 只删桥接行，事件行保留）——当前不做清理。
_避免使用_：垃圾行、悬空行

**并发写入者（concurrent writer）**：
同一 session id 的第二个写入实例——append 前校验磁盘 head，不一致
fail loud。
_避免使用_：写冲突、写竞争

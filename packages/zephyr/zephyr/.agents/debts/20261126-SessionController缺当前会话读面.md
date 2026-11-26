# 债：`SessionController` 契约缺「当前会话」读面

状态：已知，**不补**（2026-11-26 记录）。

## 事实

`ui-session` 的 scope adapter（`UiSession` 内部成员）要把 `current` 的 key 指到「当前会话」，而我们的
`SessionController` 契约（`ISessions` 适配面）**没有** `mounted` / `active` / `current` / `select` 任何一个成员。

后果：只有「目录」而没有「选中动作」的装配（测试夹具）拿不到 selected → `scope('session').current.key` 恒 `undefined`
→ 右栏 `mounted` 空 → `[data-sidebar-right-panel]` 不渲染。

## 不补的理由

- **产品侧无消费方**：真机上右栏 panel 已确认出现，说明生产路径不依赖这个契约面；
- 为一条夹具给契约加成员 = **为测试开洞**（与 `sessionAdmin.observeState`、`RemoteTransportSource` 被否的理由同一条）。

## 补的条件（不是「为了写测试」）

出现真实消费方时才补：框架层要读「当前会话」，或别的域需要「选中/切换会话」这个动作。
补的时候按今天的形态：契约成员名对齐上游、`scope` 侧的读面用 `requireScope` 表达「必须要有」。

## 现状与替代验收

- 右栏端到端判据**降级为装配级**（`dsh-conversation/src/ui/__tests__/rightbar-seats.spec.dom.tsx`：两个座位各 1 条 + 渲染期四类崩溃分别 0）；
- `[data-sidebar-right-panel]` 由**真机验收**（已确认出现）。

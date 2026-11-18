# 债：`terminal` namespace 没有 `@RemoteContract` 契约

**状态**：已知且被接受。**owner**：`@morlay/dsh-shell`（右栏终端 tab）。

## 事实

`WebTerminalsDefault.onInit` 要拿「终端组」的**上游 namespace 原始对象**，而 `@RemoteContract` / `@RemoteImpl`
没为 `terminal` 建契约。当前写法是走契约声明的口子：

```ts
const remote = inject(Remote);
await remote.$mount(TERMINAL_REMOTE);
new ClientTerminals(root as never, remote.upstream[TERMINAL_GROUP] as never);
```

- `$mount` / `whenMounted` 在契约上，**没有名字读**；
- 但 `remote.upstream[TERMINAL_GROUP]` 仍是**按上游 namespace 组名索引**——这不是 cordis 服务名，
  所以**不能宣称「彻底消除动态」**。它用的是契约显式声明的 `abstract readonly upstream`，不是 locator。

## 为什么现在不建契约

整条装配链里**只有一个消费方**（右栏终端 tab）。为一个消费方建 `@RemoteContract` 契约（还要让上游面转发）
是过度设计。

## 可判定的升级条件

**出现第二个消费方时**，必须为 `terminal` 建 `@RemoteContract` / `@RemoteImpl` 契约，然后两处都改调用契约方法、
删掉 `upstream[TERMINAL_GROUP]` 索引。

**判据（可执行）**：`grep -rn 'TERMINAL_GROUP\]' packages --include='*.ts' | grep -v __tests__` —— 出现**第二处**（非本包、
或本包第二处消费）时即触发升级；同时本债记录一并删。

## 回归保证

`dsh-shell` 的装配 spec 断言 `terminal.environment` 是函数（**行为断言**，不是 `!== undefined`）：
若 `pickFace` 错绑到「恰好也有 `terminal` 成员的服务」，`!== undefined` 会漏，行为断言能抓到。

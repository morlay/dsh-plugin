# 发布 @morlay/dsh-oxc-node 与 npm 现有 0.2.13 撞号

状态：未销账——首发前必须解决
位置：`packages/boot/dsh-oxc-node/package.json`（版本 `0.2.9`）；npm 上 `@morlay/dsh-oxc-node` 的 `latest` 是 `0.2.13`

**现象**

npm 上 `@morlay/dsh-oxc-node` 已有 `0.2.13`（来自另一条发布线，内容与本仓不同）。本仓的 `dsh-oxc-node` 版本是 `0.2.9`，按现状发布会让 `latest` 指向更旧的号，或直接撞上已发布的版本号。

**影响**

消费方 `pnpm add @morlay/dsh-oxc-node` 拿到的是另一条线的实现；按 `0.2.9` 发布则形成版本倒挂，回滚与判断兼容性都会失去依据。

**触发条件**

首发 `dsh-oxc-node` 之前；首发集合包含它，所以是本轮发布的硬前置。

**销账条件**

Done when：`dsh-oxc-node` 的首发版本号高于 `0.2.13`，且 `pnpm view @morlay/dsh-oxc-node@<新版本> version` 在 npm 可解析、装出来的 `register.mjs` 与本仓一致。

**不修的理由**

版本号属于发布时的决定；两条线的实现不同，不能复用同一个号，也不能靠覆盖已发布版本来修。

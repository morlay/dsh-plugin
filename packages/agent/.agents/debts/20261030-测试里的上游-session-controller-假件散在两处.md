# 测试里的上游 `session-controller` 假件散在两处

状态：未销账（同一份 `RemoteSessionHost` 假件在两包各抄一份，`SessionRemoteModule` 不声明它依赖的 host 模块）

**现象**

`RemoteSessionHost` 是上游 `remote.session` 的边界契约：`packages/agent/dsh-session/src/session-controller.row.ts` 里一个
`@Injectable()` 抽象类，只有一个 `abstract readonly typertRemote: unknown`。

它的假件被手写在两个 spec 里，内容逐字相同：

- `packages/agent/dsh-session/src/__tests__/sessions-host.spec.ts`；
- `packages/agent/dsh-workspace/src/__tests__/workspace-session.spec.ts`。

两份都是 `@Injectable() class FakeRemoteSessionHost extends RemoteSessionHost { readonly typertRemote = { namespace: "session", methods: [] } }`，
注释也都写着「目录端点（list / create / page / follow）不碰它，只有会话语义端点才需要真实例」。

后一个 spec 还跨包手搓整份 providers 列表：`packages/agent/dsh-workspace/src/__tests__/workspace-session.spec.ts` 逐个列
`SessionStoreDefault`、`SessionControllerHost`、`SessionEndpointDefault`、`FakeRemoteSessionHost`，等于自己复制了一遍
`SessionsHostModule` + `SessionRemoteModule` 的装配。

同时会话域的装配函数把 host 行与端点行混在一起（`packages/agent/dsh-session` 的 Module 已随 Standalone 装配面删除，待迁移）；
它装的 `SessionEndpointDefault` 注入 `RemoteSessionHost`，而提供 `RemoteSessionHost` 的 `SessionsHostModule`
（`packages/agent/dsh-session/src/sessions-host.module.ts`）不在它的 `imports` 里。仓内唯一的应用装配
`apps/dsh-custom-next/src/zephyr.module.ts` 同时装了 `SessionsHostModule` 与 `SessionRemoteModule`，所以今天能起来。

**影响**

新增第三个需要 `session/*` 目录端点的消费方（新的 spec 或新的应用装配）时，要么再抄一遍假件，要么再手搓一遍 providers 列表；
`SessionRemoteModule` 的模块自洽性靠调用方记忆——装会话端点这件事隐含要求「自己记得先装 host 模块」，少装一行的报错落在
依赖解析期，看起来像端点行本身坏了。

**触发条件**

出现第三个需要 `session/*` 目录端点的装配（spec 或应用）；或有人把 `SessionRemoteModule` 单独装进一个不带 `SessionsHostModule` 的装配。

**销账条件**

Done when：两条同时成立——

1. 假件收进 `@morlay/dsh-session/testing` 一个 home（该包 `packages/agent/dsh-session/package.json` 的 `exports` 现在只有
   `.` / `./ui` / `./contract` / `./server` / `./endpoint`），两个 spec 都从那里取；
2. `SessionRemoteModule` 的 `imports` 声明它需要的 host 模块，或把目录端点拆成不依赖上游 controller 的独立端点行，
   使「只装 `SessionRemoteModule`」能自己跑通。

**不修的理由**

一次改动同时动「测试辅助的包出口」与「模块 `imports` 语义」：前者要决定 `testing` 出口的公开面（假件是契约替身，还是要带断言辅助），
后者要决定模块嵌套装配的默认顺序。当前两个 spec 都能各自独立跑绿，先记债，等第三个消费方带着真实形状来，再一次性定这两件事。

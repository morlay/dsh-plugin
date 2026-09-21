# 桌面宿主覆写 connection 的两个认证方法

状态：未销账（桌面形态下由宿主改服务实例的方法实现「不需要认证」）

**现象**

桌面 host 入口 boot 之后把 `ctx.connection` 的两个方法改写为放行：
`requestRejection` → 恒 `undefined`、`authorizeIndex` → 恒 `true`
（`packages/desktop/dsh-desktop-host/src/transport.ts` 的 `takeOverDesktopAuthentication`，在
`src/index.ts` 里于 `runProfile` 之后调用）。

上游这两处是浏览器面的信任边界：`/api` 前缀路由与各插件 handler 自查走 `requestRejection`
（Host/Origin 栅栏 + 签名 cookie），`frontend-static` 渲染 index 前走 `authorizeIndex`。桌面页面由壳独占、
没有网络入口，认证没有对象，所以宿主直接让它们放行——不铸 cookie、壳不参与。

**影响**

上游若把认证判定从「服务方法」改成内部直接调用（例如在 `rpc-host.ts` 内部不再经过
`requestRejection`），或改方法签名，桌面形态的接管就会失效：表现是页面 401/403 打不开、或
`/api` 请求被拒，而不是静默降级。启动时有能力探测（方法缺失即抛错，fatal 上报），但
「方法还在、语义变了」探测不到。

**触发条件**

- 每次同步 `vendor/deepseek-harness`（尤其 `packages/client/connection`）之后，必须在桌面 dev 形态复验一次
  页面能打开、`/api` 请求能通；
- 上游若新增「宿主自持页面」的官方开关（`connection` 配置项或 host 侧 `ownsHost` 语义），立即按下面销账。

**销账条件**

Done when：上游提供官方开关（配置项或服务面）表达「页面自持宿主、无需浏览器认证」，我们删除这两处覆写。

**核查（2026-09-21）**：销账条件未达成。上游 `packages/client/connection/src/` 里没有「页面自持宿主、无需浏览器认证」
的开关（`ownsHost` / `selfHosted` / `skipAuth` 三个词在该目录 0 命中），两处方法覆写仍是唯一做法。

**不修的理由**

上游没有这个开关；替代方案是在宿主里自铸 cookie（`connection.authenticatedUrl` + 合成 index 请求拿
`set-cookie`，再给每个管道请求注入 `Host`/`Cookie`/`Origin` 头）——同样是私有面依赖，还要多一层
cookie 生命周期与头改写，成本更高。

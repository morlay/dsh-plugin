# @morlay/dsh-sandbox-local

可配置沙箱与审批的**运行时策略面** bundle：替换官方 `ctx.sandbox`（进程沙箱）与 `ctx.fs`（文件系统围栏），在官方
语义之上叠加 `access` 规则，并接管模型看到的运行时快照（`sandbox:policy` / `approval:policy`）。

## 用法

`access` 的两种写法等价（数组每项一条，或多行文本每行一条；空行忽略）：

```yaml
- id: sandbox-local
  config:
    access:
      - "rw {{ env.XDG_CACHE_HOME }}"
      - "r- {{ env.XDG_CONFIG_HOME }}"
      - "-- mise.*.toml"
      - "-- **/*.pem"
```

规则语法、命中优先级、平台表达能力、六个字段，以及两条运行时快照的接管方式见
[设计 可配置沙箱的规则面与平台降级](./.agents/designs/20260929-可配置沙箱的规则面与平台降级.md)。

## 装配

包的默认导出是 [`@morlay/zephyr`](../../zephyr/zephyr/README.md) 的 `toCordis()` 产物（`name` / `Config` /
`apply`）：能力包本体是 `@Injectable()` 的 `SandboxLocal` class Provider（[`zephyr.service.ts`](./src/zephyr.service.ts)）
——构造参数收行配置，`onInit(ctx)` 在行 ctx 上替换 `ctx.sandbox` / `ctx.fs` 并接管两条运行时快照。上游
`sandboxPolicy` 经 `fromCordisService("sandboxPolicy")` 的强类型令牌注入（`policy = inject(SandboxPolicy)`），由
`toCordis()` 在行 ctx 上等待并回填，不再声明字符串 `inject` 数组。Loader 取 default export，行 id 由 Provider 的
token 名派生（`sandbox-local`），包名由 `SandboxLocal.packageName`（读自本包 `package.json`）声明，行配置由
`Config` 解析后交给 Provider 构造。`name` / `Config` / `SandboxLocal` 同时保留命名导出，与默认导出是同一份事实。

行数据在本包的 `./rows` 出口（禁官方 `sandbox` / `fs-sandbox` 两行 + 插入本包一行）；采用它的部署 bundle 是
[`@morlay/sandbox-profile`](../../bundles/sandbox-profile/README.md)——它渲染出这份 patch，并在同一份 patch 里按 id
给 `sandbox-local` 的 `access` 值。部署侧只需把那个 bundle 列进 `dsh.profile.bundles`。

# 桌面化（工具与壳）

这一层的词：把任意工作区**装配**成能跑、能打包的部署时，那些"格"叫什么。
取值分形态见 [设计 数据与工作目录的 layout](./designs/20261014-数据与工作目录的-layout.md)；
边界见仓库根 [`GLOSSARY-MAP.md`](../../../.agents/GLOSSARY-MAP.md)。

## 术语

### 格（目录）

**profileDir（装配根）**：
这份部署**装配出来**的那一格——清单、`cordis.yml`、`node_modules`（或指向它的链接）都在这里；
上游按它当 profile root 装配。dev 是工作区里的 app 目录（`DSH_DESKTOP_DEV_PROFILE_DIR` 或进程 cwd）；
bundle 是 `<dataDir>/profiles/<name>`。
_避免使用_：profile 目录、app 目录（只在 dev 恰好重合）

**dataDir（`$DSH_HOME`）**：
**用户数据**那一格——会话、设置、附件、日志、`profiles/`。dev 缺省是 `<profileDir>/.dsh-store`；
bundle 由 app 的 `dsh.desktop.dataDir` 解析（`xdg` / `env` / 绝对路径）。
_避免使用_：home、数据目录

**解析根（resolution root）**：
**依赖解析**的基准——`node_modules/.pnpm`、包清单、缓存都相对它。dev 是工作区根（profileDir 在它里面，
`node_modules` 与 lockfile 也在那里）；bundle 就是 profileDir 自己（它带自己的 `node_modules`）。
_避免使用_：repoRoot（那是它在 dev 下的一个取值，不是它的定义）

**buildCache**：
**构建**工作缓存（`<workspace>/node_modules/.dshdev`）：`runtime/`、`seed/`、`deploy/`、`shell/`、
`artifacts/`。只在构建机上存在，不随产物走。
_避免使用_：构建目录、out

### 形态

**形态（form）**：
同一套"格"的**两种取值组合**——`dev`（在工作区里跑，改完即生效）与 `bundle`（把部署打成 .app）。
**没有第二套语义**：页面、前端链、loader、装配清单在两种形态下是同一条链，只是"装配根在哪、
解析根在哪、谁提供 runtime"三格的取值不同。判据只有 `DSH_DEV_FORM`（有没有值），预编译策略与
根的选择都读它。
_避免使用_：开发模式 / 打包模式（像是两套东西）

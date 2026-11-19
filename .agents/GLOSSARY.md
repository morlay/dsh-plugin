# 发布线（仓库级）

`packages/**` 的发布词汇；`devpackages/**` 与 `apps/**` 不发布，不在这个上下文里。定义权与边界见[定义权地图](./GLOSSARY-MAP.md)。

## 术语

### 发布

**发布集合**：
`packages/**` 里参与发布的包（除 `apps/**`）；`private: false` 是它在清单上的表现，`devpackages/**` 不在集合内。

_避免使用_：发布清单、白名单

**发布态**：
包装上 registry 之后消费方看到的形态——`publishConfig.exports` 指 `dist` 产物、`dsh.bundle` 带 patch、`./cordis-register` 可见。开发态指工作区里 `exports` 直连 `src` 的形态。

_避免使用_：生产态、打包态

**只发布态入口**：
产物存在、只列进 `publishConfig.exports`、顶层 `exports` 不含的出口（如 `./cordis-register`）。

_避免使用_：隐藏入口、私有出口

**dist-tag**：
registry 上的频道名，按版本号推导：稳定版 → `latest`、`-alpha.*` → `alpha`、其余预发布 → `next`。

_避免使用_：发布通道（通道指 CI 与本地两条，不是 tag）

# profile 的 `cordis.patch.yml` 豁免替换

状态：未销账（app 层装配行的后续改动送不到老用户）

**现象**

重种 profile 时，除 `cordis.patch.yml` 之外的一切都按原样替换（整目录替换 + 种子覆盖），只有这一份例外：重种
前读出用户那份、种完放回去（[`seed.ts` 的 `ensureSeedProfile`](../../../dsh-desktop-shell/src/seed.ts)）。原因是 settings 面板把配置写在
这份文件里，替换它等于每次重打包 / 升级都清掉用户设置。

**代价**

- app 自己的 `cordis.patch.yml`（profile 层装配行）改了以后**老用户拿不到**：新装机器种的是新版本，已装机器
  保留它当初那份。要送达只能让用户删掉该文件（下次启动重种）或手工并回。
- `dev --web` 形态的 profile 是同一份文件，且每次启动写 app 那份（覆盖用户设置）——dev 侧未做豁免，保持原行为。

**触发条件**

app 的 `cordis.patch.yml` 发生实质变化（新增 / 修改装配行）并已发布给老用户。

**销账条件**

Done when：装配行与用户设置**分层**——app 层不再与 settings 同文件（例如走 host 的 overlay 层，或放进某个 bundle
自带的 patch），届时替换逻辑可以恢复为完整替换、这份豁免随之删除。

**不修的理由**

把 app 层装配行搬出 profile 就得改部署的目录结构（2026-09-22 试过一版：host 增加 overlay 层、打包器把 app patch
写进 runtime 资源），桌面形态起不来；保持既有目录结构 + 只豁免这一份文件是当前唯一稳妥的取舍。

# 判别式行 Config 要靠顶层 volatile 或包一层对象才被 describe 出来

状态：未销账（两处根形状判据不同宽：我们这侧认相交段与带 tag 的 union，host 只认对象段）

**现象**

判别式配置的推荐形状是「共享标记字段 + 各分支 `const` 标记」的 `z.intersect([...])`（或带 tag 的 `z.union`），
段值仍然是对象。我们这侧已经把它当页面根（`projectRoot`：对象段 / 相交段 / 带 tag 的 union），但 host 的投影比
这窄：

- `volatileForm(schema)` 只有两条出路——顶层 `meta.volatile`，或 `type === 'object'` 时逐字段挑出 volatile 子树；
  其余根形状直接返回 `undefined`（`vendor/deepseek-harness/packages/settings/settings/src/schema.ts:37-47`）。
- 于是 `describe()` 不会列出这一行（`settings/src/index.ts:306-311`），我们的行注册也就无从注册——页面上整行
  消失，且没有提示。
- 分支内部的字段**不能**单独标 volatile：`validateVolatileSchema` 把 `inner` 与 `list` 成员都标成 blocked，祖先链
  上再有 volatile 会直接抛（`vendor/schemastery/src/index.ts:488-509`）。

结果是：写判别式行 Config 的人必须知道「要么把整段标 `.volatile()`，要么把它包在一层 `z.object` 里」，否则页面
静默消失。

**影响**

- 插件作者写出正确的判别式 schema，却看不到页面——第一反应会当成我们的 bug（没有任何日志或界面提示）。
- 顶层 `.volatile()` 是可行变通：`isVolatilePath` 对 volatile 之下的任何路径都放行
  （`settings/src/schema.ts:69-76`），所以分支字段照样能写；代价是**整段**都可编辑（连接串、部署路径之类也跟着
  上页面），判据从"逐字段"退化成"整段"。`session-rdb` 就是这么做的：`z.union([...]).volatile()`，页面上 `type`
  是只读 const（切后端仍要改 YAML），同后端内的参数可改。
- 两处判据不同宽，改任何一侧都要同时看另一侧，容易被下游误读成"我们支持了非对象根"或"host 不支持"。

**触发条件**

- **写判别式/非对象根的行 Config 之前**：先决定是包一层 `z.object` 还是整段 `.volatile()`，并在这里补一句为什么。
- 上游把 `volatileForm` 的根形状放宽（或明确"非对象根由客户端自行投影"）时：重评这条债。

**销账条件**

Done when：host 的 `volatileForm` 能投影非对象根（相交段 / 带 tag 的 union）里的 volatile 子树——届时本包的
README「什么能当页面根」只剩一条判据（我们自己的），不再提示 `.volatile()` 变通。

**不修的理由**

- 上游只读，改不了 `volatileForm`；我们这侧无法替 host 决定"要不要把这一行描述出来"。
- 变通成本低且语义自洽：顶层 volatile 的语义就是"这一段整段可实时改"，判别式段本来就该整段编辑。
- 眼下没有真实消费者要吃这个亏（我们自己的行 Config 都是对象段或整段 volatile），先把事实写在这里，等第一个
  非对象根的行出现时再按触发条件处理。

# zephyr-ui（client 基础面）

对话 UI 与设置页共用的基础面：官方组件的统一出口、布局原语、本套控件、按 schema 生成的行配置页、引用解析。
普通库，不是装配行；只出浏览器组件与 host 侧的引用纯函数，不拥有任何具体域的槽位、数据与文案。
上下文边界见仓库根 [.agents/GLOSSARY-MAP.md](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

### 配置页

**页读数**（row form state）：
渲染层读的一份投影：表单壳状态（可用 / 可写 / 脏 / 非法 / 保存中 / 失败）、字段树、每个具体路径的草稿状态、secret 槽的「已配置」标记。它与 `ctx.configForms.get(ns)` 的快照不是一回事：后者是 host 的读写两层，页读数是「这些值加本页草稿」之后的渲染视图。
_避免使用_：表单状态（会与表单壳混淆）

**字段树**（field tree）：
schema 投影出的**结构**（`FieldNode`）：类型、路径、归一化 meta、只读原因。它不含值，也不含文案——值在草稿模型里，文案在渲染时解析。
_避免使用_：表单 schema、字段模型

**动态段**（`*`）：
字段树里 dict 的值、数组的项这类「按值才有具体地址」的层级，投影时用 `*` 占位；渲染层按真实键或索引替换后再交给字段槽。

**模板路径**（template path）：
提示面注册时写的带 `*` 的路径（`["models", "*", "provider"]`）：一次注册覆盖每个动态键。读侧按具体路径查，精确路径优先于模板。

**候选键**（suggested keys）：
某个 dict 字段「可能出现哪些键」的运行期清单，由业务在客户端注册同步读数。表单一侧把「候选里有、值里没有」的键列为可添加项。

**可添加项**（addable）：
所在容器声明了、非必填、值里又还没有的那一项。它不占行，出现在容器闭合行添加入口的候选里，选中才加成。

**行**（editor line）：
配置页的最小单位：结构行（`{}` / `[]`）、字段行（`key: value`）、注释行。行序 = 视觉顺序，行号即下标——渲染层只按行画，不递归。

**注释行**（comment line）：
画在对应行上方的 `// …`：schema 的 `description` / `comment`、字段槽给的 label / hint，以及「只读」这类一眼看不出的状态。

**添加入口**（add input）：
跟在容器闭合括号同一行的输入框：对象从可添加项里选，字典能自己敲键名（也能从候选里选），数组是追加一个空项。

**成员行**（member line）：
动态容器的成员（数组的项、字典的键）在页面上自己的那一行：名字（项身份或 `#序号`）与移除按钮。

**草稿**（draft）：
本页尚未写盘的一处编辑。编辑只落在草稿上，`save` 是唯一的写盘点；保存时整段过一遍 schema 校验。

**覆盖**（overridden）：
这一字段的用户层里有条目——**presence 判据**，不是值比较：覆盖值恰好等于默认值也算覆盖。

**字段槽**（field slot）：
`settings.schema-form.field`，chain 槽。注册项的 `select(field)` 按 `node.meta.role` 或 `ns + path` 认领字段，命中即渲染它的组件，没人认领就渲染默认控件。

**项身份**（mergeKey）：
数组成员的「名字」取自它自己的哪个字段：显式声明（`role("items", { mergeKey })`）优先，否则 item 上的 `id`。它决定页面上的项标题与「同一层不重名」的本地校验；写盘仍按索引。

**判别标签**（tag）：
union 按哪个字段的值挑变体：显式声明（`role("union", { tag })`）优先，否则所有对象成员共有的唯一常量字段。

**变体切换**（variant control）：
union 字段行尾的那个小下拉：带标签的挂在标签行上（选它等于写标签值），没有标签的按值的形状切（写目标变体的空值）。

**候选值**（select spec）：
某个字段「可以选哪些值」的运行期读数：字段据此画成下拉；`dependsOn` 里声明的兄弟字段一改，投影时就用新值重算候选。

**具名候选源**（named source）：
注册在提示面上的候选读数，由 schema 的 `role("select", { source })` 认领：一个源可被多行、多个字段复用；没声明或没注册时退回按路径登记的那份。

**只读字段**（read-only fact）：
标了 `.disabled()` 的字段：值照画、注释标「只读」，但不给编辑入口。

**只读原因**（readOnly）：
节点不能编辑的原因：`transform`（callback 不可逆）、`function`、`constructor`（`is` 判定）。`const` 不是原因，它是类型本身。

**递归收口**（`recursive` 节点）：
自引用 schema 回到祖先的那一层：投影在那里停下，渲染成一行只读提示。

### 组件与控件

**布局原语**：
`Stack` / `Row` / `Text`（`src/client/layout/`），档位常量在 `scales.ts`。业务页面只摆结构与选档，不写样式。

**设置面控件**（settings controls）：
跨设置面复用的控件，由本包统一转出：字段行 `SettingsFieldRow`、可搜索选择器 `SearchSelect`、模型路由清单 `ModelRouteList`、标签输入 `TagInput`、多行文本 `MultilineField`、图标按钮 `IconButton`、座位按钮 `SeatButton`、气泡 `Bubble`、`Spinner`、`TimeLabel`、`VisuallyHidden`。

**data-role**：
每个内容组件带的一个稳定属性（`button` / `icon-button` / `search-select` / `tag-input` / `field-row` …）：它是「这是个什么控件」的身份，供样式、测试与自动化定位。

### 出口

**apply**：
`src/client/index.ts` 的 `apply(ctx)`：装上提示面、字典与字段槽 Factory。由**内联本包的 client 行**在 `onInit` 里调用；多份副本靠「提示面已在场就返回」幂等。

**提示面**（`schemaFormHints`）：
`apply` 在运行期挂到根 ctx 上的服务（`src/client/schema-form/hints.ts`）：字段文案、候选键、候选值三类注册。消费方按 `schemaFormHintsOf(ctx)` 读，不能 `inject`。

**引用解析**：
`findReferences` / `parseReferenceToken`（host 侧，出口 `./reference`）与 `parseReference` / `formatReference` / `ReferenceMarkdown`（浏览器侧，出口 `.`）。

### 装配形态

**内联库**（inline lib）：
随消费方一起进页面的库：没有 `provide([...])` 清单、没有 `./client` 出口、不写 `dsh.bundle`，装配只靠消费方调 `apply`。

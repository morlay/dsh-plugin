# @morlay/dsh-client-ui-schema-form

把各插件 Config 里标了 `.volatile()` 的字段，按 schema 自动渲染成**那一行**的配置页（浏览器半）。插件只声明
schema，页面不用写客户端代码；字段级想换值控件或换文案，经一个 chain 槽注入。

配置页是**行式 JSON 结构视图**（不是逐字段的上下表单）：

```
 1 │ {
 2 │   // 新会话用哪个模式
 3 │   default: "coding"
 4 │   modes: {
 5 │     coding: {
 6 │       // 能用的工具
 7 │       allowTools: [ "read" ]      ← 闭合行自带添加入口
 8 │     }
 9 │   }
10 │   models: {}                    ← 还没配的键在这个入口的候选里
11 │   access: [ ]  ▾                ← 值本身就是下拉的触发
12 │   cwd: "/Users/morlay/repo"     // 相对路径的基准目录 · 只读
13 │ }
```

- **出现哪些字段**：**必填字段始终占行**（值还没有也看得见"必须填"）；**非必填的按值出现**——值里没有就不占行，
  它出现在所在容器闭合行的添加入口候选里，选中才加成（模式清单这类候选键同样如此）。
  判据就一条：**`undefined` = 这一层没有这个字段**（不渲染，去候选里）；**`null` = 有字段、值还没填**——那一格直接
  是一个等着输入的位子（不是 `""` / `0` 这种看着像已经填过的值）。加进来的项初值因此是：有默认值给默认值、容器给
  空的容器、其余标量给 `null`；host 侧也认这个语义（非必填拿到 `null` 回退默认值，必填拿到 `null` 就是"必须填"）。
- **行**：行号 + 折进 + `key: value`。**缩进只作用在行内容上**（行号列固定在左边，第一层就缩进一格）；容器是
  `{` / `[` 的开启行与 `}` / `]` 的闭合行，可折叠（`collapse()` 决定默认，点 chevron 反转）。点行号选中这一行。
- **改过的行看得出来**：本页改了还没保存的字段左边一道强调色，悬停里是**「撤回」**；已经存进用户层的用一道浅灰，
  悬停里是**「恢复默认」**。两种状态之外还有「复制」与成员行的「移除」。
- **值**：语法色 token（字符串带引号、数字、布尔、`null`），**点开即改**——点开后行里只留输入框（原值不再在旁边画
  一遍）：官方 `Input`，旁边常显**确认（✓）/ 取消（✕）**两个按钮（确认收起这一格的编辑、取消把值退回去），
  Enter 提交 / Esc 撤销同理；**带换行的值给同一观感的多行输入**（Enter 换行、高度跟着内容长）。非法输入在行内给出
  消息并挡住保存。细线与描边取 theme 的 token（`dsw.elevation.stroke` 那一档），不自己写宽度与颜色。
- **注释行**：`// …` 画在对应行上方——`description` / `comment` 与业务文案（提示面给的 label/hint），以及「只读」
  这类一眼看不出的状态；「已覆盖」不在这里（它是行尾那个「恢复默认」按钮的事）。
- **添加入口跟容器的闭合括号同一行**（输入框与行内编辑同一观感）：对象列的是**还没配的声明字段**（带说明），
  字典列的是业务注册的候选键（也能自己敲键名），数组是「追加一个空项」；粘一整段 `{…}` / `[…]` 则整层覆盖。对象
  只认 schema 声明过的字段——敲一个没声明的键不会被写下去（host 也会挡）。
- **选择器**：字段有候选（字面量集合的 `union`，或提示面注册的候选值）时，**值本身就是下拉的触发**（同一个值不画
  两遍），点开是官方菜单；候选依赖的兄弟字段一变就换一批。
- **变体切换**：`union` 的字段行尾给一个小触发——判别式 union 挂在**标签行**上（`type: "sqlite" ▾`，切到 `postgres`
  就换一整套字段），没有标签的按值的形状切（`access` 在 `[ ]` 与 `""` 之间）。
- **只读字段**：`.disabled()` 的字段（装配事实这类）照常画出值、注释里标「只读」，但点不开编辑。
- **控件都是官方的**：行内输入用 `Input`、下拉与候选用 `Menu`，视觉与键盘行为跟设置页其余部分一致。

## 用法

业务插件：在自己的 `Config` 上标 `.volatile()` 就够了（页面自动出现在该行的配置入口里）。

```ts
export const Config = z.object({
  maxDepth: z.number().step(1).min(0).default(1).volatile(),
});
```

想给某个字段换控件或只改文案：注册到 chain 槽 `settings.schema-form.field`，按 `role` 或 `ns + path` 认领。
`select` 返回认领结果或 **`null`**（`null` 才是不认领，`undefined` 不是）；命中后由注册方的组件渲染——只想改
文案就拿本包的默认控件包一层。

```tsx
import {
  SchemaFieldDefault,
  type SchemaFieldComponentProps,
} from "@morlay/dsh-client-ui-schema-form/client";

/** 认领时给出的文案：与 `select` 的返回类型逐字一致（框架据此把 `matched` 认成 selector 的结果）。 */
type Match = { label: string; hint: string };

ctx.slots.inject("settings.schema-form.field", () =>
  ctx.slots.register(
    {
      name: "settings.schema-form.field",
      // 具体路径形如 ['models', <模式 id>, 'provider']；也可以按 field.node.meta.role 认领。
      select: (field): Match | null =>
        field.ns === "session-mode" && field.path[0] === "models" && field.path[2] === "provider"
          ? { label: "服务商", hint: "llm-openai-compatible 的 providers 里的键" }
          : null,
    },
    function ProviderField(field: SchemaFieldComponentProps<Match>) {
      return (
        <SchemaFieldDefault
          owner={{ ...field, label: field.matched.label, hint: field.matched.hint }}
        />
      );
    },
  ),
);
```

自写控件时用 `field.value` / `field.onChange` / `field.onReset`（值全部走草稿，`save` 是唯一写盘点），容器
动作（`field.actions`）只在字段是数组或字典时有意义；分组节点还有 `field.group`（开合）。

## 接缝

| 面                            | 形状                                                                                                    | 谁用         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| `plugins.row.config`（keyed） | 本包为每个可渲染的行各注册一项，key = `<bundle 包名>#<行 id>`，`priority: 100`                          | 插件管理页   |
| `settings.schema-form.field`  | chain 槽：`select(field)` 按 `role` 或 `ns + path` 认领字段，命中即渲染自己的组件（未命中落默认控件）   | 业务插件     |
| `settings.schema-form.form`   | 本包注册的 Factory：行入口经 `renderFactorySlot` 渲染它（字段槽的 children 声明收在它上面，只声明一次） | 本包（内部） |
| `./client` 出口               | `apply` + 槽契约类型 + `SchemaFieldDefault`（默认控件，供只改文案时复用）                               | 浏览器半     |
| `.` 出口                      | 空 `apply`（占 Loader 行；本包没有 host 侧行为）                                                        | 装配         |

手写卡片用默认 `priority: 0` 注册，按 slots 的 cell winner 规则自然遮住这里的自动项，所以两种页面可以并存、
迁移不必一次做完。

## 能力

- **类型覆盖**：`object` / `dict` / `array` / `tuple` / `string` / `number` / `boolean` / `bitset` / `const` /
  `union` / `intersect` / `any` / `never` / `transform` / `function` / 递归引用（收口成只读一行）。
- **分组折叠**：`collapse()` 的分组默认收起来，点标题行展开；折叠的组不渲染它的子树。
- **dict 的候选键**：schema 里写不出来的键（运行期清单，例如「会话模式」那一行的模式 id）由业务在客户端注册——
  候选里有、值里没有的键进的是这一层的**添加入口候选**，选中才加成。用法见下面「提示面」一节。
- **动态容器的成员行**：数组的每一项、字典的每一个键都有自己的行——名字（数组项优先用项身份 `id`，否则 `#序号`；
  字典用键名）加移除按钮，成员自己的字段排在它下面一级；空容器给一行占位（「还没有项 / 还没有键」）加添加入口。
  按值展开时，成员的路径与名字都换成真实的键/序号（占位段 `*` 不会出现在页面上）。
- **数组的项身份**：item 是对象且带 `id`（或 `role('items', { mergeKey: 'x' })` 显式声明）时，页面上用它的值
  当项标题，并在保存前校验同一层不重名——写盘仍按索引（host 的 path op 就是索引语义）。
- **判别式 union**：两种表达都认——① `z.union([z.object({ kind: z.const("a"), … }), …])`（分支自带标记字段）；
  ② 共享标记字段的 `z.intersect([z.object({ shared, type: z.union([...]) }), z.union([z.object({ type: z.const("a"), … }), …])])`
  （标记字段在共享层，因此它在页面上是**可切换的选择器**，分支字段跟着换）。tag 取显式声明
  `role('union', { tag: 'kind' })`，否则取所有对象成员共有的唯一常量字段。
  schemastery 没有 schema 层的查表式判别（`union` 按声明顺序逐个 try，第一个通过即胜出；`zod` 的
  `discriminatedUnion` 只出现在浏览器侧的 RPC 校验里），所以 tag 是**渲染与本地校验**的选支依据：页面选变体不
  依赖分支顺序，host 侧校验仍按顺序尝试。相交成员描述同一字段时（共享层的选择器与分支里的 `const` 标记）按路径
  去重，先出现的那个留下。没有标签的 `union` 按**值的形状**选支（`z.union([z.array(z.string()), z.string()])` 这类
  ——`access` 就是它），页面上是同一个切换控件，切过去写目标变体的空值；带标签的写标签值（`type: "postgres"`）。

## 提示面：文案、候选键、候选值

业务知道、schema 表达不了的三类信息都放这里（`ctx.schemaFormHints`）：**字段文案**（`describe`，行式视图画成注释
行）、**dict 的候选键**（`suggestKeys`，进的是这一层添加入口的候选）、**字段的候选值**（`select`，字段画成
选择器）。

三类注册都按路径定位，路径里的动态段写 `*`（模板路径）就覆盖每个模式、每个键——业务不必知道运行期有哪些键；
精确路径优先于模板。

```ts
const hints = ctx.get("schemaFormHints");

// 文案
hints?.describe("session-mode", ["models", "*", "provider"], () => ({
  label: "服务商",
  hint: "providers 里的键",
}));

// dict 的候选键（取到清单之后再注册，注册本身会通知一次）
hints?.suggestKeys("session-mode", ["models"], () => roster.modes.map((row) => row.id));

// 候选值：`dependsOn` 里声明的兄弟字段一变，候选就重算
hints?.select("session-mode", ["models", "*", "model"], {
  dependsOn: [["provider"]],
  options: (read) => modelsOf(read(["provider"])),
});
```

读数必须**同步**（投影发生在渲染帧里）：异步来源（HTTP / remote）由业务自己取好再注册；数据变了但没重新注册时
主动调一次 `hints.refresh()`。选模型那一套（provider 目录 + 模型清单）的落点见
[`dsh-session-mode`](../../profile/dsh-session-mode/README.md)。

### 按 role 认领的候选源

字段自己说清"这是什么选择"，业务不去记行 id 与路径：schema 上写 `role('select', { source })`，客户端注册那个
**具名源**（源可以被多行、多个字段复用）：

```ts
// schema 侧
provider: z.string().role("select", { source: "llm-providers" }),
model: z.string().role("select", { source: "llm-models" }),

// client 侧（一次注册，两个源各管一件事）
hints?.source("llm-providers", { options: () => providers.map((p) => ({ value: p.id })) });
hints?.source("llm-models", {
  dependsOn: [["provider"]],
  options: (read) => modelsOf(read(["provider"])),
});
```

`kind` 是 `unknown` 的值、字段名换了行，源照样对得上——**认领靠 role，不靠 `ns + path`**。没写 `source`、或那个源
没注册时，退回按路径登记的那份（`hints.select(ns, path, …)` 仍然有效）；两者都没有就还是文本编辑。

## 声明自定义属性

schemastery 的自定义属性位是 **`meta.extra`**（`any`），公开设置方法是 `.role(名字, extra)`——上游自己也这么用
（`percent()` 给 `role: 'slider'`、`regExp()` 给 `role: 'regexp'` + `extra.flag`）。本包认的两个约定都走这个通道：

```ts
z.array(z.object({ id: z.string() })).role("items", { mergeKey: "id" }); // 数组项的项身份
z.union([z.object({ kind: z.const("a") })]).role("union", { tag: "kind" }); // union 的判别标签
```

约束：自定义属性要**能被 JSON 序列化**——host 发的是 `schema.toJSON()`（`JSON.parse(JSON.stringify(...))`），
函数会静默消失、`Map`/`Set` 变成 `{}`、循环引用会抛。所以 `extra` 里只放数据（字符串、数字、纯对象）。

想注册**自定义类型**（新的 `type` + 解析器）是另一件事：`Schema.extend(type, resolve)`，进程级全局注册。

## 判据与限制

- **Config 只能是 schemastery**（本包吃的就是它的形状）：cordis 侧只要求 Standard Schema v1（zod / valibot 也
  行），但 host 的 settings 描述只认带 `toJSON()` 的 schema（`packages/settings/settings/src/index.ts:425`），
  客户端再用 `new Schema(json)` 重建——所以别的校验库写的 Config 进不了设置页，也就进不了这里的自动表单。
  顺带一处 schemastery 特有：loader 写回配置时用 `Config.simplify`（`vendor/loader/src/index.ts:117`）。
- **什么能当页面根**：对象段、相交段（判别式那种），以及带 tag 的 `union`（成员都是对象）；字面量 `union`
  （整段是标量）不行——那会把写盘变成整段替换。注意 host 的 `volatileForm` 只认对象段与顶层 volatile，所以判别式
  行 Config 要写成 `z.intersect([...]).volatile()`（或包一层 `z.object`）才会被描述出来——原因与销账条件见
  [债务 判别式行 Config 要靠顶层 volatile 才被 describe](./.agents/debts/20260924-判别式行Config要靠顶层volatile才被describe.md)。
- **什么能上页面**：插件行 `Config` 里标了 `.volatile()` 的字段——host 的 `describe()` 只投影那部分。
  **生效靠 Loader 重挂被改的行**（settings 写完经 `reconcileProfilePatches` 让 Loader 重装 entry），所以插件
  装配时取一次配置快照即可；要在不重挂的前提下改（长生命周期对象）才需要现场读 `.get()`。
  装配期决定的项（能力清单、子插件传参、进程 cwd 之类）想**只读可见**就用 `.volatile().disabled()`：`volatile`
  让它进投影，`disabled` 让页面只画值不给编辑。注意 `volatile` 会把解析后的值变成**引用**（读它要 `.get()`），
  所以交给上游基类的那份配置要先解包（落点见 [`dsh-sandbox-local`](../../sandbox/dsh-sandbox-local/README.md)）
  ——判据与各包落点见[设计记录](./.agents/designs/20260924-schema自动生成行配置表单与字段槽注入.md)。
- 字段值的读写、暂存语义、schema 支持面与测试落点见[如何验证](./.agents/standards/how-to-verify.md)。
- 设计与取舍（为什么用 Factory、为什么字段槽只声明一次、为什么不引第二份表单原语）见
  [设计记录](./.agents/designs/20260924-schema自动生成行配置表单与字段槽注入.md)。
- 装配是 profile bundle 的一行 insert：`packages/session/better-session/cordis.patch.yml` 的 `ui-schema-form`。
- `transform` 字段只读呈现（callback 不可逆，写回会让语义漂移）；`function` / 构造器类型同样只读。

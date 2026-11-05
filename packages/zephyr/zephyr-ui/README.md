# @morlay/zephyr-ui

对话 UI 与设置页共用的**基础面**：上游官方组件的统一出口（`Button` / `Menu` / `Input` / `Modal` / `Switch` /
`SettingsForm` / 图标 …）、布局原语（`Stack` / `Row` / `Text`）、这套界面自有的控件（字段行 / 可搜索选择器 /
标签输入 / 图标按钮 …）、按 schema 生成配置页的模型与组件，以及引用解析与渲染（host 与 client 共用同一份源码）。

它是**普通库，不是装配行**：没有装配清单，装载幂等（见
[ADR 基础面暂时内联而不是装配行](./.agents/adrs/20261001-暂时内联而不是装配行.md)）。样式与控件的写法约束见
[规范 how-to-write](./.agents/standards/how-to-write.md)；schema 表单与字段槽的机制见
[设计 按 schema 自动生成行配置表单与字段槽注入](./.agents/designs/20260924-schema自动生成行配置表单与字段槽注入.md)。

## 出口

| 出口          | 是什么                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| `.`           | 浏览器组件库：官方组件转出 + 布局原语 + 控件 + 设置表单原语 + schema 表单面 + 引用渲染 |
| `./reference` | host 侧也用的引用解析（`findReferences` / `parseReference` 这类纯函数，不碰 React）    |

## 用法

```ts
import { IconButton, SearchSelect, SettingsFieldRow, TagInput } from "@morlay/zephyr-ui";
import { findReferences } from "@morlay/zephyr-ui/reference";
```

业务页面组设置面时，控件与字段摆位都从这里取：

```tsx
<SettingsFieldRow label="允许的工具" hint="留空 = 不限制" divider layout="inline">
  <TagInput
    value={tools}
    onChange={setTools}
    placeholder="加一个后回车，或粘贴一串"
    label="允许的工具"
  />
</SettingsFieldRow>
```

按 schema 生成的配置页：插件侧只标 `.volatile()`，页面由本包的 `SchemaFormController` + `SchemaForm` 画出来。

```ts
export const Config = z.object({
  maxDepth: z.number().step(1).min(0).default(1).volatile(),
});
```

装载（`apply`）：装上提示面、字典与字段槽 Factory，幂等。

```ts
import { apply } from "@morlay/zephyr-ui";

apply(ctx);
```

页面本身由 `SchemaFormController`（一行 schema → 页面读数与动作）与 Factory `settings.schema-form.form`
（渲染体，经 `renderFactorySlot` 取）组合出来。

想给某个字段换控件或只改文案：注册 chain 槽 `settings.schema-form.field`，在 `select` 里认领字段。

```tsx
import { SchemaFieldDefault, type SchemaFieldComponentProps } from "@morlay/zephyr-ui";

ctx.slots.inject("settings.schema-form.field", () =>
  ctx.slots.register(
    {
      name: "settings.schema-form.field",
      select: (field) => (claim(field) ? { label: "服务商" } : null),
    },
    function ProviderField(field: SchemaFieldComponentProps<{ label: string }>) {
      return <SchemaFieldDefault owner={{ ...field, ...field.matched }} />;
    },
  ),
);
```

业务要往页面补候选键 / 候选值 / 字段文案：按名读 `schemaFormHintsOf(ctx)`（面见 `SchemaFormHintsFace`）。
**不能用 `inject(SchemaFormHints)`**：这份服务是 `apply` 在运行期挂的，装配清单里没有它的条目，装配期的覆盖检查
会直接拒绝——判据见 `src/client/__tests__/hints-injection.spec.ts`。

## 装配

**不是装配行**：没有 `provide([...])` 清单、没有 `cordis.patch.yml`、不写 `dsh.bundle`。`apply(ctx)` 由消费方调用一次；
多份副本各自带一份代码，靠根 store 上的提示面服务判重。

行配置入口（哪个 bundle 的哪一行在哪儿打开配置页）**不属于本包**：那需要读 `plugin-manager` 的 bundle 行清单，
本仓库不接这一面。

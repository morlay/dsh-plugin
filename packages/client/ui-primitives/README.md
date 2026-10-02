# @morlay/dsh-client-ui-primitives

对话 UI 与设置页共用的**基础面**：**css-in-js 样式层**（`styled` / `Token` / `dsw`，消费官方主题注入的
`--dsw-*`，源码可直接加载）、**引用解析与渲染转换**（host 与 client 共用唯一一份源码，
[`@morlay/dsh-reference`](../../context/dsh-reference/README.md) 的引用展开复用 host 那半）、**官方基础组件的统一出口**
（`Button` / `Menu` / `Modal` / `Switch` / `SegmentedControl` / `DisclosureRow` / 图标 … 由本包 `export *` 转出，业务包
只向本包取控件），以及**设置面原语**（从上游 fork 的暂存式表单原语、按 schema 自动生成的行配置页，加上这套设置面
自有的控件：字段行 `SettingsFieldRow`、可搜索选择器 `SearchSelect`、模型路由清单 `ModelRouteList`、标签输入 `TagInput`、
多行文本 `MultilineField`、图标按钮 `IconButton`、按钮 `Button`）。

## 用法

```ts
import { styled, dsw, findReferences } from "@morlay/dsh-client-ui-primitives/client";
```

按 schema 生成的那一页：

```ts
// 插件侧：Config 标 volatile，页面自动出现在该行的配置入口里
export const Config = z.object({
  maxDepth: z.number().step(1).min(0).default(1).volatile(),
});
```

```tsx
// 想给某个字段换控件或只改文案：注册 chain 槽（select 返回 null 才是不认领）
import {
  SchemaFieldDefault,
  type SchemaFieldComponentProps,
} from "@morlay/dsh-client-ui-primitives/client";

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

设置表单原语是暂存式的：控件只上报用户输入，`save` 是唯一写盘点。

```ts
import { SettingsFormModel, settingsNumberField } from "@morlay/dsh-client-ui-primitives/client";

const form = new SettingsFormModel(scope, [settingsNumberField("timeoutMs")]);
```

业务页面组设置面时，控件与字段摆位都从这里取（**业务层不写控件外观**）：

```tsx
import {
  IconButton, SearchSelect, SettingsFieldRow, TagInput,
} from "@morlay/dsh-client-ui-primitives/client";

<SettingsFieldRow label="允许的工具" hint="留空 = 不限制" divider layout="inline">
  <TagInput
    value={tools}
    onChange={setTools}
    placeholder="加一个后回车，或粘贴一串"
    label="允许的工具"
    removeLabel={(name) => `移除 ${name}`}
  />
</SettingsFieldRow>
```

装配：**不是装配行**——client 半随用到它的 client 行内联（清单里标 `dsh.client.inline`，devkit 因此不把它当
模块表里的行外置），装配入口 `apply` 由那些行各自调用、按服务在场与否幂等去重；`styling` 单例跨副本共享一份。
取舍见 [ADR 基础面暂时内联而不是装配行](./.agents/adrs/20261001-暂时内联而不是装配行.md)。

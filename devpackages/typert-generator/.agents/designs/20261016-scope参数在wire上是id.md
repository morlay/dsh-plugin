# scope 参数在 wire 上是 id，不是宿主对象

## 事实

上下文参数（`@RemoteScope` 的 receiver，以及"参数类型命中 `TypertLookupMap` 宿主对象"的方法）在 wire 上
的载荷是**一个 id**，不是宿主侧那个上下文对象：

```ts
// 宿主侧的源码签名
list(agent: Agent): readonly CommandDescriptor[]

// 生成的 descriptor（host 面）
{ name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent',
  codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: … } }
```

`wire` 名是 `${查找表 key}Id`（key 取的是 `TypertLookupMap` 里的键，例如
`agent: TypertLookup<Agent, SessionId>` → `agentId`），**不是参数名**——两者恰好相同时才会看着一致。

## 命中判据（与上游 `analyzer.ts` 对齐）

1. **按宿主对象类型命中**：参数类型必须是 lookup 表里那个宿主类型（`Agent` / `WorkspaceFileScope`）。
   **不能按 wire id 类型**（`SessionId`）命中：它同时是 agent / session / workspaceFileScope 的 wire
   类型，按 id 类型认会把 `list(sessionId: SessionId)`、`retain(sessionId, id)` 误当成
   workspaceFileScope 参数——gateway 会把 `{ sessionId, workspaceRoot }` 对象塞进这个位置，宿主拿它当
   字符串查表，于是终端清单恒空、`retain` 恒 `terminal/unavailable`（侧栏终端"此终端已不存在，请新建
   终端"就是这么来的）。
2. **参数名必须等于 lookup key**、且不能 optional；wire 名是 `${key}Id`。
3. **`@RemoteScope` 是 Context receiver**：descriptor 写作
   `invocation: { kind: 'context', context, wire }`，receiver 不占业务 `parameters`；它只要求
   `TypertContextMap` 条目（只有 lookup 条目不够）。
4. **自动 scope**：direct 方法**恰好一个** lookup 参数、且同名条目也在 `TypertContextMap` 里时，
   descriptor 才写 `scope`。多个 lookup 参数时上游不设 scope（参数仍按 lookup 传）。
5. 同一方法只能有一个 `@Remote` / `@RemoteScope` 装饰器；取消通道必须是末尾的
   `signal: AbortSignal`，名字与类型缺一即报错。

## 因此生成器的两条约束

1. **descriptor 的 `wire`**：取查找表的 key（`lookup.key`），不要拿参数名或 `method.scope` 兜底——
   一个方法可以有多个 lookup 参数（此时没有 `scope`），从 `method.scope` 取会写出 `undefinedId`。
2. **客户端参数的 schema**：按 **id 的类型**生成（`SessionId` → `z.string()`），**不能**按参数节点声明的
   宿主对象类型生成（`Agent` → `z.object({ id: … })`）。后者会让客户端发对象、服务端按字符串 `parse`，
   gateway 报：

   ```
   gateway/input-invalid: typert gateway: commands/list:
   wire field "agentId" failed boundary validation
   ```

## 与 `acceptsUndefined` 的分工

两者都会在 gateway 的 `decode` 路径上体现，但管的是不同的事：

- `acceptsUndefined: true`（可选参数）→ 影响 `missing` 判定，缺字段时不再算错，报错类型是
  `gateway/arguments-invalid`；
- 上面那条 schema 形态 → 值本身过不了 strict codec，报错类型是 `gateway/input-invalid`。

排查时先看报错类型：`arguments-invalid` 往字段有没有上想，`input-invalid` 往值的形态上想。

## 守据

`src/__tests__/contexts-upstream.spec.ts` 逐条落地上游判据（声明表形态、lookup 参数、scope 推导、
`@RemoteScope` receiver、取消通道）；`src/__tests__/generate.spec.ts` 覆盖产物三件套的端到端形态。

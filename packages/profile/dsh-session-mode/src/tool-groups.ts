// 按需工具分组：一个组是**注册表里的名字面**（不含描述——被收窄掉的工具定义读不到，列表只给名字与数量）。
// 组名与组归属的事实 home 是 `shared.ts`（`toolGroupOf` / `isResidentToolGroup` / `groupRef`）：host 与 client
// 两半都要它，这里只做"名字全集 → 按需组"的投影。
import { groupRef, isResidentToolGroup, toolGroupOf } from "./shared.ts";

// 名字面 → 按需组名（`mcp:<server>` / `group:<id>`）→ 这个组里的工具名（保持注册顺序）。
// 常驻组不进这张表：它们的工具默认就在目录里，不需要按需放行。
export function groupTools(names: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = toolGroupOf(name);
    if (isResidentToolGroup(group)) continue;
    const key = groupRef(group);
    const tools = groups.get(key);
    if (tools === undefined) groups.set(key, [name]);
    else tools.push(name);
  }
  return groups;
}

// 名单里引用整组时的写法：MCP 组直接用 `mcp:<server>`，其余加 `group:` 前缀。
//
// 纯字符串处理、两端共用（宿主半用它收口名单，浏览器半用它渲染面板的组引用），所以放 `endpoint/`：
// 浏览器半**不引宿主半**，那两个方向只有这条出口。
export function groupRef(group: string): string {
  return group.startsWith("mcp:") ? group : `group:${group}`;
}

export function refGroup(ref: string): string {
  return ref.startsWith("group:") ? ref.slice("group:".length) : ref;
}

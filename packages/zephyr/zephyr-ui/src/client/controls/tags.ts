// 名单类字段的文本解析：把粘贴或输入的一串名字折成标签列表。

// 分隔符：中英逗号、分号、制表符与换行；去空白、去重、保序。
export function parseTagList(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/[,，;；\t\n\r]+/u)) {
    const name = raw.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

// 把新名字并进现有名单：去重、保序（现有的在前），返回新数组（一次替换就是一次编辑动作）。
export function mergeTags(current: readonly string[], incoming: readonly string[]): string[] {
  const merged = [...current];
  for (const name of incoming) {
    if (name === "" || merged.includes(name)) continue;
    merged.push(name);
  }
  return merged;
}

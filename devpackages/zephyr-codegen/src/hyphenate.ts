// 行 id 规则：与 zephyr `internal.ts` 的 hyphenate 同算法（类名的大写边界转 `-`）。
// 规则来源与取舍见 README；判据见 `src/__tests__/hyphenate.spec.ts`。

type NameState = "delim" | "upper" | "lower";

export function hyphenate(source: string): string {
  const output: string[] = [];
  let state: NameState = "delim";
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      if (state === "upper") {
        const next = source.charCodeAt(index + 1);
        if (next >= 97 && next <= 122) output.push("-");
      } else if (state !== "delim") {
        output.push("-");
      }
      output.push(String.fromCharCode(code + 32));
      state = "upper";
      continue;
    }
    if (code >= 97 && code <= 122) {
      output.push(String.fromCharCode(code));
      state = "lower";
      continue;
    }
    if (code === 45 || code === 95) {
      if (state !== "delim") output.push("-");
      state = "delim";
      continue;
    }
    output.push(String.fromCharCode(code));
  }
  return output.join("");
}

export type TokenLike = Function & {
  readonly providerName?: unknown;
};

// zephyr 的 `getTokenName` 优先用注册表里的名字（适配类注册时取上游插件名），这里按同一优先级
// 读类上的同名静态字段。
export function tokenNameOf(token: TokenLike): string {
  if (typeof token.providerName === "string" && token.providerName.length > 0) {
    return token.providerName;
  }
  if (token.name.length === 0) {
    throw new Error("provider has no class name; cannot derive a row id");
  }
  return hyphenate(token.name);
}

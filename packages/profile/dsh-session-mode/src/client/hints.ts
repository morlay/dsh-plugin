// 行配置页与提示面共用的命名空间/解包：从 `bundle-config.ts` 抽出来，配置页移除后仍要给提示面用。

export const SESSION_MODE_NS = "session-mode";

// cordis 会把服务值包成追踪代理（`Symbol.for("cordis.original")` 指回原始实例）。代理上的方法调用以代理为
// `this`，而服务实现用的是 JS 私有字段——先解包成原实例再调。
export function unwrapService<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  const original = (value as { [key: symbol]: unknown })[Symbol.for("cordis.original")];
  return (original ?? value) as T;
}

export interface HintsLike {
  textFor(ns: string, path: readonly string[]): { label?: string; hint?: string };
  selectFor(ns: string, path: readonly string[]): unknown;
  sourceFor(name: string): unknown;
  subscribe(listener: () => void): () => void;
}

export interface HintsService extends HintsLike {
  describe(
    ns: string,
    path: readonly string[],
    read: () => { label?: string; hint?: string },
  ): () => void;
  select(
    ns: string,
    path: readonly string[],
    spec: { options: () => readonly unknown[] },
  ): () => void;
  source(
    name: string,
    read: {
      options: (
        read: (path: readonly string[]) => unknown,
      ) => readonly { value: string; label?: string }[];
      dependsOn?: readonly (readonly string[])[];
    },
  ): () => void;
  refresh(): void;
}

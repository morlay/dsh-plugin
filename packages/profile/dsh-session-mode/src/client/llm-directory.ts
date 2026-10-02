// 部署的 LLM 目录读数：provider 候选（活着的路由 + 可配置声明）与每个 provider 的模型清单（在声明指向的那份
// 配置里）。
//
// 两处消费它：提示面的 `llm-providers` / `llm-models` 两个具名源（行配置页与通用 schema 表单用），以及 bundle
// 配置页的模型路由清单——"已设置的模型"按**路由**给，一条路由就是 provider + model 这一对。

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";

// 一条可选路由：`key` 是稳定身份（调用方只用来比对，不解析它）。
export interface ModelRoute {
  readonly key: string;
  readonly provider: string;
  readonly providerName: string;
  readonly model: string;
  readonly modelName: string;
}

// 一个 provider 与它当前可用的模型。
export interface ProviderModels {
  readonly value: string;
  readonly label: string;
  readonly models: readonly { readonly value: string; readonly label: string }[];
}

// 路由的稳定身份：provider 与 model 一起才是路由。
export function routeKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

// 客户端 remote 的命名空间是一个**独立服务**（服务名 `remote.<命名空间>`，gateway 的 client 半按 mount 注册），
// 不是 `remote` 服务上的属性——属性访问读到的是 `undefined`。读不到（这一版部署没装那个命名空间）就按"没有"处理。
export function remoteNamespace<T>(scope: Context, namespace: string): T | undefined {
  try {
    return (scope as unknown as { get(key: string): unknown }).get(`remote.${namespace}`) as
      | T
      | undefined;
  } catch {
    // 服务没注册时 `ctx.get` 抛错：按"这个命名空间不在这一版部署里"处理。
    return undefined;
  }
}

// LLM 命名空间里本包用到的那两个读面：活着的路由与可配置声明。
interface LlmReader {
  listProviders: () => Promise<
    { ok: true; value: readonly { id: string; name: string }[] } | { ok: false }
  >;
  listConfigurableProviders: () => Promise<
    | {
        ok: true;
        value: readonly {
          provider: string;
          displayName: string;
          settingsNs: string;
          settingsPath: readonly string[];
        }[];
      }
    | { ok: false }
  >;
}

// 一份 provider 档案的读数面（模型清单住在声明指向的那份配置里）。
interface ConfigFormsReader {
  get(ns: string): { getSnapshot(): { value: unknown } };
}

// 按路径读一段配置里的值。
function readAt(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (typeof node !== "object" || node === null) return undefined;
    return Reflect.get(node, segment);
  }, root);
}

// 一个 provider 当前有哪些模型：声明给了配置地址就按路径读它的 `models`（每项取 `id`）。
function modelsOf(
  entry: { settingsNs: string; settingsPath: readonly string[] },
  forms: ConfigFormsReader,
): readonly { value: string; label: string }[] {
  if (entry.settingsNs === "") return [];
  const profile = readAt(forms.get(entry.settingsNs).getSnapshot().value, entry.settingsPath);
  const models =
    typeof profile === "object" && profile !== null ? Reflect.get(profile, "models") : undefined;
  if (!Array.isArray(models)) return [];
  return models.flatMap((model) => {
    if (typeof model !== "object" || model === null) return [];
    const id = Reflect.get(model, "id");
    if (typeof id !== "string") return [];
    // 显示名优先取档案里的 `name`（"DeepSeek V4.1 Flash @ Ollama Cloud" 这种），没有就用 id。
    const name = Reflect.get(model, "name");
    return [{ value: id, label: typeof name === "string" && name !== "" ? name : id }];
  });
}

// 部署里"已设置"的 provider 与它们的模型：活着的路由与可配置声明合并（按 provider 去重，声明的显示名优先）。
export async function loadLlmProviders(scope: Context): Promise<readonly ProviderModels[]> {
  const llm = remoteNamespace<LlmReader>(scope, "llm");
  const forms = (scope as unknown as { get(key: string): unknown }).get(
    "configForms",
  ) as ConfigFormsReader | undefined;
  if (llm === undefined || forms === undefined) return [];
  const [routes, directory] = await Promise.all([
    llm.listProviders(),
    llm.listConfigurableProviders(),
  ]);
  if (!routes.ok || !directory.ok) return [];
  const merged = new Map<string, { value: string; label: string; settingsNs: string; settingsPath: readonly string[] }>();
  for (const entry of directory.value) {
    merged.set(entry.provider, {
      value: entry.provider,
      label: entry.displayName,
      settingsNs: entry.settingsNs,
      settingsPath: [...entry.settingsPath],
    });
  }
  for (const route of routes.value) {
    if (!merged.has(route.id)) {
      merged.set(route.id, {
        value: route.id,
        label: route.name,
        settingsNs: "",
        settingsPath: [],
      });
    }
  }
  return [...merged.values()].map((entry) => ({
    value: entry.value,
    label: entry.label,
    models: modelsOf(entry, forms),
  }));
}

// 目录里的每一条路由（provider + 它有模型的每一项）：bundle 配置页的模型清单用它。
export function routesOf(providers: readonly ProviderModels[]): readonly ModelRoute[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: routeKey(provider.value, model.value),
      provider: provider.value,
      providerName: provider.label,
      model: model.value,
      modelName: model.label,
    })),
  );
}

// dsh 行入口（bundle 层）：包根只出**具名**的插件面（name / inject / apply）。
// cordis 的 unwrapExports 取 `default ?? exports`；没有 default 时，命名空间本身就是插件对象。
import plugin from "./dsh-bundle.ts";

export const name = plugin.name;
export const inject = plugin.inject;
export const apply = plugin.apply;

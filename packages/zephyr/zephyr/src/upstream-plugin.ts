// dsh 行能接受的上游插件形状。
import { Context as CordisContext } from "@deepseek-ai/cordis";

export type PluginRef = PluginClass | ObjectPlugin;
export type PluginClass = new (ctx: CordisContext, config?: any) => any;

export interface ObjectPlugin {
  name?: string;
  inject?: readonly string[];
  Config?: (value?: any) => any;
  apply(ctx: any, config?: any): any;
}

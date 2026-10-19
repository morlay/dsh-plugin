// 适配层内部入口：只给确实需要把已存在的 cordis 服务映射成令牌的适配代码用。
export {
  fromCordisService,
  onService,
  provideToken,
  resolveProvider,
  type CordisServiceToken,
} from "./from-cordis.ts";
export { attachProvider, attachProviders } from "../attach.ts";

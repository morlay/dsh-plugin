// 平台账号契约：令牌按服务语义命名。
import type PlatformAccount from "@deepseek-ai/dsh-deepseek-account-platform";
import { Injectable } from "@morlay/zephyr";

/** 平台账号的公开面由上游插件按需提供；契约令牌只固定身份。 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface DeepseekAccountFace {}

@Injectable()
export abstract class DeepseekAccount implements DeepseekAccountFace {}

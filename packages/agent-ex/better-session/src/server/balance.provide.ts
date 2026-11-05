import { Injectable, provide } from "@morlay/zephyr";
import { balanceRewindPrefix, rewindKeepLength } from "../endpoint/balance.ts";

/**
 * 配平算法的**注入面**：算法本身是 `./endpoint` 的纯函数，这里只把它挂成 Provider，
 * 让装配清单里也能出现"日志配平"这一行（消费方注入本类即可，不必直接 import 函数）。
 */
@Injectable()
export class SessionBalance {
  readonly balance = balanceRewindPrefix;

  readonly keepLength = rewindKeepLength;
}

export const provideSessionBalance = provide([SessionBalance]);

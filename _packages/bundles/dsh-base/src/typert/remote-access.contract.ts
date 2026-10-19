// 远程访问准入契约：令牌按服务语义命名（上游注册名 `remoteAccess`）。
import type RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { Injectable } from "@morlay/zephyr";

interface RemoteAccessFace {
  readonly invalidate: RemoteAccessService["invalidate"];
  readonly decide: RemoteAccessService["decide"];
}

@Injectable()
export abstract class RemoteAccess implements RemoteAccessFace {
  abstract readonly invalidate: RemoteAccessFace["invalidate"];

  abstract readonly decide: RemoteAccessFace["decide"];
}

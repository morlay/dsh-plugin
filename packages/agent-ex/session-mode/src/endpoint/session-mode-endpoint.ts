// `sessionMode` 这一组的跨端契约：组名、方法名与请求 / 响应形状。
//
// 两端共用同一份声明：宿主侧实现它（`server/`），浏览器侧按消费它（`ui/` 的 `@RemoteClient()`）。
// **不继承 `RemoteClientBase`**：那个基类带 `inject(Remote)`，而 `Remote` 只有浏览器侧有。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/client/remote";
import type { ModeConfig } from "./mode-config.ts";
import type {
  SessionModeActiveState,
  SessionModeCatalogValue,
  SessionModePatch,
  SessionModeRoster,
} from "./session-mode-shapes.ts";

// 某个会话的身份参数。
export interface SessionModeOfRequest {
  readonly sessionId: string;
}

// 把某个空白会话切到某个模式。
export interface SessionModeSelectRequest {
  readonly sessionId: string;
  readonly mode: string;
}

export interface SessionModeSelectValue {
  readonly mode: string;
}

// 会话级字段覆盖（`null` = 回到模式默认）。
export interface SessionModePatchRequest {
  readonly sessionId: string;
  readonly patch: SessionModePatch;
}

// 一次应用整份会话覆盖。
export interface SessionModeApplyConfigRequest {
  readonly sessionId: string;
  readonly config: ModeConfig;
}

// 把草稿写回模式配置（"保存为默认"）。
export interface SessionModeSaveConfigRequest {
  readonly sessionId: string;
  readonly config: ModeConfig;
}

// 以当前生效配置另存为一个新模式。
export interface SessionModeSaveAsRequest {
  readonly sessionId: string;
  readonly code: string;
  readonly name?: string;
}

export interface SessionModeSaveAsValue {
  readonly mode: string;
}

// `sessionMode` 组：清单 / 生效态 / 切换 / 面板写面 / 全局候选。
// 每个方法的第一个形参就是请求对象（wire 上统一叫 `request`）。
@RemoteGroup({ name: "sessionMode" })
export class SessionModeEndpoint {
  // 模式清单 + 默认模式。
  @RemoteMethod()
  async roster(): Promise<SessionModeRoster> {
    throw new Error("sessionMode/roster：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 某个会话当下生效的那一份。
  @RemoteMethod()
  async active(_request: SessionModeOfRequest): Promise<SessionModeActiveState> {
    throw new Error("sessionMode/active：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 把一个空白会话切到某个模式。
  @RemoteMethod()
  async select(_request: SessionModeSelectRequest): Promise<SessionModeSelectValue> {
    throw new Error("sessionMode/select：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 改这个会话的字段覆盖。
  @RemoteMethod()
  async patch(_request: SessionModePatchRequest): Promise<SessionModeActiveState> {
    throw new Error("sessionMode/patch：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 一次性应用整份会话覆盖。
  @RemoteMethod()
  async applyConfig(_request: SessionModeApplyConfigRequest): Promise<SessionModeActiveState> {
    throw new Error("sessionMode/applyConfig：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 把草稿写回模式配置（对新会话生效）。
  @RemoteMethod()
  async saveConfig(_request: SessionModeSaveConfigRequest): Promise<SessionModeActiveState> {
    throw new Error("sessionMode/saveConfig：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 把当前会话的覆盖写回这个模式。
  @RemoteMethod()
  async saveAsDefault(_request: SessionModeOfRequest): Promise<SessionModeActiveState> {
    throw new Error("sessionMode/saveAsDefault：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 以当前生效配置另存为一个新模式。
  @RemoteMethod()
  async saveAs(_request: SessionModeSaveAsRequest): Promise<SessionModeSaveAsValue> {
    throw new Error("sessionMode/saveAs：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 删除一个"另存为"出来的模式；返回会话回到的那个模式。
  @RemoteMethod()
  async remove(_request: SessionModeOfRequest): Promise<SessionModeSelectValue> {
    throw new Error("sessionMode/remove：契约类未实现（宿主侧要在子类里实现它）");
  }

  // 全局候选：部署里当前可见的工具名与技能名。
  @RemoteMethod()
  async catalog(): Promise<SessionModeCatalogValue> {
    throw new Error("sessionMode/catalog：契约类未实现（宿主侧要在子类里实现它）");
  }
}

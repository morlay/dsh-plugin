// 上游会话端点面的**契约**（抽象类），与实现（`server/api-session.provide.ts`）分开。
//
// 写法：每个抽象类的成员类型**直接取上游实例的同名成员**（`Upstream["list"]` 这种），
// 再配一条 `AssertCovered<上游实例, 本契约>` 守卫——**上游有而契约没列的成员，编译期就报错**。
// 这样"契约漏了成员"不靠记忆、不靠人眼，也就不用担心 `fromCordis` 装上一个面不全的契约。
//
// `fromCordis(契约类, 上游实现类)` 双参是硬要求：装任何上游实现之前，先说清它的面。
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";
import { Injectable } from "@morlay/zephyr";
// 四个上游行只用来取**实例类型**（`InstanceType<typeof ...>`，全是类型位置）：
// 写成 `import type` 才是真的"只取类型"——值导入会被打包图收边，把上游宿主行拖进浏览器 bundle。
import type FileReferenceServicePlugin from "@deepseek-ai/dsh-file-reference-local";
import type SessionControllerPlugin from "@deepseek-ai/dsh-api-session-controller";
import type SessionFileReferencesPlugin from "@deepseek-ai/dsh-api-session-controller/src/file-references.ts";
import type SessionSkillCatalogPlugin from "@deepseek-ai/dsh-api-session-controller/src/skill-catalog.ts";

/** 上游 `SessionController` 的实例面（成员类型都从这里取，避免手抄走样）。 */
type SessionControllerUpstream = InstanceType<typeof SessionControllerPlugin>;

/**
 * `sessionController`：`session` 组的全部端点（上游 `SessionController`）。
 *
 * 27 个成员逐个列；`typertRemote` 是 `TypertRemoteService` 基类挂的绑定（gateway 靠它发现端点）。
 */
@Injectable()
export abstract class SessionControllerService {
  /** 上游基类挂的 remote 绑定（`{ service, serviceKey, namespace }`）：gateway 的发现依据。 */
  abstract readonly typertRemote: SessionControllerUpstream["typertRemote"];

  /** 解析一个会话的活 agent 或冷会话（`prompt` / `rename` 这类端点的公共前置）。 */
  abstract readonly resolveAgent: SessionControllerUpstream["resolveAgent"];

  /** 列会话目录（读查询索引，不读 live store）。 */
  abstract readonly list: SessionControllerUpstream["list"];

  /** 搜索会话。 */
  abstract readonly search: SessionControllerUpstream["search"];

  /** 新建会话（会话与 agent 一起建）。 */
  abstract readonly create: SessionControllerUpstream["create"];

  /** 切某个会话的模型。 */
  abstract readonly selectModel: SessionControllerUpstream["selectModel"];

  /** 把默认模型写入会话。 */
  abstract readonly initializeDefaultModel: SessionControllerUpstream["initializeDefaultModel"];

  /** 模型目录（provider 分组 + 默认选择 + 失败面）。 */
  abstract readonly modelCatalog: SessionControllerUpstream["modelCatalog"];

  /** 本机能否用原生方式打开路径。 */
  abstract readonly canOpenWorkspacePath: SessionControllerUpstream["canOpenWorkspacePath"];

  /** 当前桌面信息（文件管理器类型等）。 */
  abstract readonly workspaceDesktop: SessionControllerUpstream["workspaceDesktop"];

  /** 用原生方式打开一个工作区路径。 */
  abstract readonly openWorkspacePath: SessionControllerUpstream["openWorkspacePath"];

  /** 某个路径可用的「用什么打开」列表。 */
  abstract readonly workspacePathApplications: SessionControllerUpstream["workspacePathApplications"];

  /** 改会话标题。 */
  abstract readonly rename: SessionControllerUpstream["rename"];

  /** 从某个会话 fork。 */
  abstract readonly fork: SessionControllerUpstream["fork"];

  /** 发一条 prompt（`(request, signal)`：signal 无条件 `throwIfAborted`）。 */
  abstract readonly prompt: SessionControllerUpstream["prompt"];

  /** 读一个附件（durable 引用 + base64 字节）。 */
  abstract readonly attachment: SessionControllerUpstream["attachment"];

  /** 改待发队列。 */
  abstract readonly updateQueue: SessionControllerUpstream["updateQueue"];

  /** 取消当前轮次。 */
  abstract readonly cancel: SessionControllerUpstream["cancel"];

  /** 读一页事件（冷读）。 */
  abstract readonly page: SessionControllerUpstream["page"];

  /** 读一页事件（同一实现的别名端点）。 */
  abstract readonly events: SessionControllerUpstream["events"];

  /** 订阅事件（无快照）。 */
  abstract readonly observeEvent: SessionControllerUpstream["observeEvent"];

  /** 订阅投影增量（无基线）。 */
  abstract readonly observeProjections: SessionControllerUpstream["observeProjections"];

  /** 读被动状态。 */
  abstract readonly state: SessionControllerUpstream["state"];

  /** 订阅被动状态的整份替换。 */
  abstract readonly observeState: SessionControllerUpstream["observeState"];

  /** 等会话静默或待输入。 */
  abstract readonly wait: SessionControllerUpstream["wait"];

  /** 跟一条会话日志（opening 快照 + 逐帧事件）。 */
  abstract readonly follow: SessionControllerUpstream["follow"];

  /** 读一份精确的投影值（cached 只在需要迁移时给）。 */
  abstract readonly projections: SessionControllerUpstream["projections"];

  /** Host 级控制流：一帧完整基线 + 之后的替换帧。 */
  abstract readonly control: SessionControllerUpstream["control"];
}

/** 覆盖守卫：上游有而契约没列的成员，编译期必须为空。 */
export type SessionControllerCovered = AssertTrue<
  AssertCovered<SessionControllerUpstream, SessionControllerService>
>;

/** 上游 `LocalFileReferenceService` 的实例面。 */
type FileReferenceUpstream = InstanceType<typeof FileReferenceServicePlugin>;

/**
 * `fileReferences`：`@` 引用的候选来源。
 *
 * 上游把契约（`abstract class FileReferenceService`）与本地实现分成两个包，我们只引用实现；
 * 候选逻辑一行不写，所以这里只有它对外的一个方法。
 */
@Injectable()
export abstract class FileReferenceService {
  /** 按前缀列出候选路径（`list(prefix, cwd, signal)`）。 */
  abstract readonly list: FileReferenceUpstream["list"];
}

/** 覆盖守卫：上游有而契约没列的成员，编译期必须为空。 */
export type FileReferenceCovered = AssertTrue<
  AssertCovered<FileReferenceUpstream, FileReferenceService>
>;

/** 上游 `SessionFileReferences` 的实例面。 */
type SessionFileReferencesUpstream = InstanceType<typeof SessionFileReferencesPlugin>;

/** `sessionFileReferences`：`fileReferences/list` 端点（wire 命名空间 `fileReferences`）。 */
@Injectable()
export abstract class SessionFileReferencesService {
  /** 上游基类挂的 remote 绑定：gateway 靠它发现端点。 */
  abstract readonly typertRemote: SessionFileReferencesUpstream["typertRemote"];

  /** 列候选（`list(request, signal)`）。 */
  abstract readonly list: SessionFileReferencesUpstream["list"];
}

/** 覆盖守卫：上游有而契约没列的成员，编译期必须为空。 */
export type SessionFileReferencesCovered = AssertTrue<
  AssertCovered<SessionFileReferencesUpstream, SessionFileReferencesService>
>;

/** 上游 `SessionSkillCatalog` 的实例面。 */
type SessionSkillCatalogUpstream = InstanceType<typeof SessionSkillCatalogPlugin>;

/** `sessionSkillCatalog`：技能目录（wire 命名空间 `skills`）。 */
@Injectable()
export abstract class SessionSkillCatalogService {
  /** 上游基类挂的 remote 绑定：gateway 靠它发现端点。 */
  abstract readonly typertRemote: SessionSkillCatalogUpstream["typertRemote"];

  /** 列某个会话可见的用户可调用技能（`list(request, signal)`）。 */
  abstract readonly list: SessionSkillCatalogUpstream["list"];
}

/** 覆盖守卫：上游有而契约没列的成员，编译期必须为空。 */
export type SessionSkillCatalogCovered = AssertTrue<
  AssertCovered<SessionSkillCatalogUpstream, SessionSkillCatalogService>
>;

/**
 * `sessionMediaReferences`：prompt 里图片块的准入（上游 `SessionMediaReferences`）。
 *
 * 它是**对象插件**（`{ inject, apply }`），挂载后只注册一条 `/api/file` 路由，**不提供任何服务**，
 * 所以契约是空的。写出来是为了让 `fromCordis(契约, 实现)` 的双参形态保持统一：
 * 装任何上游实现之前，都要先说出它的面（哪怕这个面是"没有"）。
 */
@Injectable()
export abstract class SessionMediaReferencesService {}

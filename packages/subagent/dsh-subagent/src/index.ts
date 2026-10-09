/**
 * Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a
 * capability-validating asynchronous start API. Providers establish a
 * child before returning its run, so fulfillment is the single publication and
 * ownership-transfer boundary.
 *
 * Multiple providers coexist: each registers under a unique name and callers
 * select one by name.
 *
 * This package owns the Service Definition role of the capability seam. Service Providers
 * (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing
 * consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.
 *
 * `startActivation` establishes every child under the activation manager, which
 * owns execution, result delivery, and resource release. Local providers seed
 * resumable Agents; external providers return a single execution handle.
 * `sendMessage` steers between adjacent local Agents without exposing
 * whether a child is resident. Discovery combines real child Sessions with
 * parent-owned records for external executions.
 * Direct discovery reads parent catalogs; descendants recursively read reachable
 * child catalogs. External entries are leaves without local Sessions.
 *
 * Same-process providers are trusted typed collaborators. Requests, provider
 * descriptors, results, and lifecycle payloads are borrowed immutable values;
 * serialization and hostile-input validation belong at real process, worker,
 * persistence, and model boundaries.
 *
 * @module @deepseek-ai/dsh-subagent
 */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-attachment'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-subagent'
// 服务面声明（`ctx.agentPresets`）由它给：回报指引按会话挂的 preset 选文案。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  rejectPrompt, validateControlRequest,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/control.ts'
import type {
  SubagentDelivery,
  SubagentInterruptReceipt,
  SubagentPromptReceipt,
  SubagentPromptRequest,
  SubagentPromptRequestId,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/control-types.ts'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  SubagentCapabilities,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentInterruptAuthority,
  SubagentProvider,
  SubagentSendMessageOptions,
  SubagentStartRequest,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/types.ts'
import { SubagentError } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/error.ts'
import { assertSubagentMaxDepth } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/depth.ts'
import { createActivationObserver, createLifecycleEmitter } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/lifecycle.ts'
import type { ActivationObserver, LifecycleEmitter } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/lifecycle.ts'
import SubagentManager from './manager.ts'
import { installDelegationContext } from './delegation-context.ts'
import { listChildren as listSubagentChildren, listDescendants as listSubagentDescendants } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/list-children.ts'
import type { SubagentDescendantListEntry } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/list-children.ts'
import { installSubagentArchiveAdmission } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/archive-admission.ts'
import type { SubagentCatalogEntry } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/projection-types.ts'
import { subagentIdentityProjectionDefinition, subagentTimingProjectionDefinition } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/projection.ts'
import { subagentCatalogProjectionDefinition } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/catalog.ts'
import { deliverSubagentPrompt } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/internal.ts'

export type {} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/catalog.ts'
export * from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/out-of-process.ts'
export { AssistantOutputFold, finalAssistantOutput } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/assistant-output.ts'
export { SubagentRunId } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/types.ts'
export type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  SubagentCapabilities,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentInterruptAuthority,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentSendMessageOptions,
  SubagentStartRequest,
  ResolvedSubagentStartRequest,
  SubagentStopReason,
  SubagentStopReasonMap,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/types.ts'
export {
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/descriptor.ts'
export type {
  ContinuableSubagentDescriptorData,
  ContinuableSubagentDescriptorInput,
  OneShotSubagentDescriptorData,
  SubagentDescriptorData,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/descriptor.ts'
export { STRUCTURED_OUTPUT_TOOL } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/structured.ts'
export { SubagentError } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/error.ts'
export { assertSubagentMaxDepth, delegationDepthOf } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/depth.ts'
export {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  parentAgentOptionsForDelegation,
  resolveChildAgentOptions,
  resolveChildDepth,
  SubagentDepthError,
} from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/child-agent.ts'
export type { ChildComposition, DelegatedPolicyOverrides } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/child-agent.ts'
export type { AgentMessageSource, SubagentSettledMessageSource } from './continuation-messages.ts'
export type * from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/control-types.ts'
export type { SubagentDescendantListEntry } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/list-children.ts'
export type { SubagentRunEndInfo, SubagentRunInfo } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/types.ts'
export type { SubagentCatalogEntry, SubagentIdentityProjection, SubagentTimingProjection } from '../../../../vendor/deepseek-harness/packages/subagent/subagent/src/projection-types.ts'


/**
 * Durable attribution of one browser-authored follow-up. The Session
 * Controller declares this `user-rpc` message source and depends on this
 * package, so the fields are spelled here: `MessageSource`'s `user` member
 * accepts the record and the correlation id rides the durable message the
 * Client reconciles its optimistic prompt against.
 */
interface BrowserPromptSource {
  readonly kind: 'user'
  readonly rpcId: SubagentPromptRequestId
  readonly clientTimeZone?: string
}

/** Host configuration for continuable subagent capacity. */
export interface Config {
  /** Maximum live children sharing uninterrupted continuable parent links; defaults to 8. */
  maxActiveSubagents: Volatile<number>
  /** Default delegation depth for tools without an explicit limit; defaults to 1. */
  maxDepth: Volatile<number>
  /**
   * Preset ids the Chinese return guidance is restricted to; empty (default) means no restriction.
   *
   * 不配 = 任意 preset 的会话都用本包的中文回报指引（官方四个 shipped preset 也在内，还有还没绑 preset 的会话）。
   * 要反过来只让某几份 preset 用中文，就在这里列出来。装配面，不是用户面——所以不进设置页（`.hidden()`）。
   */
  localizedReturnGuidancePresets: string[]
}

/** Named provider registry with managed activations, durable discovery, and local child messaging. */
export class SubagentRuntime extends TypertRemoteService {
  static Config = z.object({
    maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
    maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile(),
    localizedReturnGuidancePresets: z.array(z.string()).default([]).hidden(),
  })
  static inject = ['workingDirectory']
  private providers = new Map<string, SubagentProvider>()
  private manager: SubagentManager | undefined
  /**
   * The contained lifecycle-edge publisher. Built here because scoped dispatch
   * keys its carrier by this exact service instance, whose own context filter
   * composes into the carrier.
   */
  private readonly emitLifecycle: LifecycleEmitter

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagents')
    // 模型看到的委派范围说明换成中文（见 `./delegation-context.ts`）。
    installDelegationContext(ctx)
    this.emitLifecycle = createLifecycleEmitter(this.ctx, parent => scopeTarget(this, parent))
    ctx.inject(['agents'], (childCtx: Context) => {
      const manager = new SubagentManager(childCtx, {
        startExternal: (name, request) => {
          const provider = this.expectProvider(name) as SubagentProvider & Required<Pick<SubagentProvider, 'start'>>
          return provider.start(request)
        },
        prepareContinuable: (name, request) => this.prepareContinuable(name, request),
        observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent),
      }, () => this.config.maxActiveSubagents.get(), () => this.config.localizedReturnGuidancePresets)
      this.manager = manager
      childCtx.effect(() => () => {
        /* v8 ignore else -- one injected binding owns the slot until its fiber disposes. */
        if (this.manager === manager) this.manager = undefined
      }, 'subagents.managerBinding()')
    })
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(subagentCatalogProjectionDefinition)
      projectionCtx.sessionProjections.register(subagentTimingProjectionDefinition)
      projectionCtx.sessionProjections.register(subagentIdentityProjectionDefinition)
    })
    // Archive admission: this runtime is the owner that knows which live
    // children descend from a Session and how a parent stops them.
    ctx.inject(['agents'], (agentsCtx: Context) => { installSubagentArchiveAdmission(agentsCtx) })
  }

  /**
   * Resolve a delegation tool's depth policy against the current user setting.
   * @param configured - Explicit tool limit, or provider-managed for external delegation.
   * @returns The numeric limit, or undefined when the provider owns depth enforcement.
   */
  resolveMaxDepth(configured?: number | 'provider-managed'): number | undefined {
    if (configured === 'provider-managed') return undefined
    if (configured !== undefined) return configured
    const depth = this.config.maxDepth.get()
    assertSubagentMaxDepth(depth)
    return depth
  }

  /**
   * Start a local child under its reserved identity.
   * @param spec - local task, reserved child id, and result recipient.
   * @returns activation with its accepted initial message id.
   */
  startActivation(spec: SubagentActivationSpec & { readonly childId: SessionId }):
  Promise<SubagentActivation & { readonly messageId: MessageId }>
  /**
   * Start a local or external child.
   * @param spec - task, backend, and result recipient.
   * @returns activation with a message id only for local children.
   */
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
  /**
   * Establish a managed child with backend-specific execution capabilities.
   * @param spec - task, backend, and result recipient.
   * @returns identities, execution result, and exact-activation disposal. A reserved
   * childId requires a local backend and guarantees an accepted messageId.
   */
  async startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation> {
    const provider = this.expectProvider(spec.provider)
    if (spec.childId !== undefined && provider.prepareContinuable === undefined) {
      throw new SubagentError('reserved child ids require a local backend', 'UNSUPPORTED_CAPABILITY')
    }
    assertSubagentMaxDepth(spec.request.maxDepth)
    this.assertCapabilities(provider, { ...spec.request, signal: spec.signal })
    const manager = this.requireManager()
    if (this.ctx.get('agents')?.get(spec.request.parent.id) !== spec.request.parent) {
      throw new SubagentError('subagent creation requires the exact live parent agent', 'UNAUTHORIZED')
    }
    if (spec.request.outputSchema !== undefined) assertObjectJsonSchema(spec.request.outputSchema)
    return provider.prepareContinuable === undefined
      ? manager.startExternal(spec)
      : manager.startLocal(spec)
  }

  /**
   * Join progressing descendants without cancelling them. Idle descendants whose
   * inboxes require a later wake stay resident and do not delay host completion.
   * @param parent - the exact parent whose descendant work is observed.
   * @returns whether work was joined; hosts recheck parent idle after true.
   */
  async waitForChildren(parent: Agent): Promise<boolean> {
    return this.manager?.waitForChildren(parent) ?? false
  }

  /**
   * Steer one model-authored message to the sender's direct parent or direct
   * continuable child. A running target admits it at the nearest step boundary;
   * an idle target starts a turn, and an absent direct child cold-resumes from
   * persistence. The service derives durable sender attribution from the exact
   * live sender. Caller cancellation stops only pre-acceptance work.
   * @param sender - exact live Agent authorizing and originating the message.
   * @param targetId - durable direct-parent or direct-child session id.
   * @param content - model-authored content to deliver.
   * @param options - caller cancellation before inbox acceptance.
   * @returns the accepted message's inbox id.
   * @throws when continuation services are unavailable, adjacency is rejected,
   *   or the message was not admitted.
   */
  async sendMessage(
    sender: Agent,
    targetId: SessionId,
    content: ContentBlock[],
    options: SubagentSendMessageOptions,
  ): Promise<MessageId> {
    return this.requireManager().sendMessage(sender, targetId, content, options)
  }

  /**
   * Deliver one host-protocol message to a direct continuable child.
   * Symbol-keyed so host adapters can preserve their own source descriptors without
   * widening the public Service Definition or impersonating an Agent sender.
   * @param parent - exact live direct parent authorizing delivery.
   * @param childId - durable direct-child session id.
   * @param content - host-authored content to deliver.
   * @param source - durable host-protocol source descriptor.
   * @param signal - caller cancellation before inbox acceptance.
   * @param delivery - Queue as a distinct turn or Steer at the nearest step.
   * @returns the accepted message's inbox id.
   */
  private [deliverSubagentPrompt](
    parent: Agent,
    childId: SessionId,
    content: ContentBlock[],
    source: MessageSource,
    signal: AbortSignal,
    delivery: SubagentDelivery,
  ): Promise<MessageId> {
    return delivery === 'steer'
      ? this.requireManager().steerPrompt(parent, childId, content, source, signal)
      : this.requireManager().queuePrompt(parent, childId, content, source, signal)
  }

  /**
   * Interrupt one live child's current execution under a human parent
   * address or an exact live ancestor Agent. Fire-and-return: the cancel
   * signal is issued before this returns, but the target may keep running
   * until it observes the signal. Unclaimed pending inbox work, the Activation,
   * and published descendants are preserved; claimed work is not requeued.
   * Once the interrupted Agent is idle, a waking send resumes the parked FIFO
   * queue. External backends stop their single execution. An absent target
   * is an accepted no-op, as is a manager-less composition, which cannot own a
   * live Activation.
   * @param targetSessionId - the durable child session id to interrupt.
   * @param authority - the human parent address or exact live ancestor Agent.
   * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
   *   live target.
   */
  interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void {
    this.manager?.interrupt(targetSessionId, authority)
  }

  /**
   * Close subagent admission below exact live parent Agents, stop only their
   * visible descendant Activations synchronously, then await admitted scoped
   * materializations and release those forests child-first. The scoped cutoff
   * lasts until each exact parent leaves the registry; unrelated parent trees
   * remain live.
   * @param parents - exact host-owned parent Agents entering teardown.
   * @returns once every retained descendant activation released its execution handle.
   * @throws an aggregate error after all branches settle when any failed.
   */
  async drainDescendants(parents: readonly Agent[]): Promise<void> {
    const manager = this.manager
    // An absent activation manager cannot own materialized children.
    if (manager === undefined) return
    await manager.drainDescendants(parents)
  }

  /**
   * Release selected resident direct children of one exact live
   * parent. Other children of the same parent remain admitted and resident.
   * Absent targets and a manager-less composition are accepted no-ops.
   * @param parent - exact live direct parent authorizing the selected release.
   * @param childIds - durable direct-child ids to release when resident.
   * @returns once every selected activation released its execution handle.
   * @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
   *   different parent or the supplied parent identity is stale.
   */
  async drainChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void> {
    const manager = this.manager
    if (manager === undefined) return
    await manager.drainChildren(parent, childIds)
  }

  /**
   * Read the parent's durable direct-child catalog without loading or resuming an Agent.
   * The service owns and releases the live-preferred Session observation.
   * @param parentSessionId - parent whose direct children are requested.
   * @param signal - cancellation forwarded to the Session query.
   * @returns catalog children in parent event order.
   * @throws {@link SubagentError} when query or catalog projection is unavailable.
   * @throws SessionQueryError when the parent cannot be read or the query is cancelled.
   */
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentCatalogEntry[]> {
    return listSubagentChildren(this.ctx, parentSessionId, signal)
  }

  /**
   * Recursively list reachable parent catalogs in stable pre-order, preserving
   * each catalog's event order. Each row carries its catalog parent and depth;
   * external children are leaves; one-shot and unknown-mode children remain
   * traversal nodes. Unknown modes
   * produce unsupported diagnostics. Unreadable child catalogs produce corrupt
   * or unavailable diagnostics and stop only that branch. Root read failures,
   * missing services or projections, and cancellation reject the whole listing.
   * Each catalog is observed once and released before the next read. No Agent
   * is loaded or resumed; Sessions absent from reachable catalogs are omitted.
   * @param rootSessionId - session whose catalog starts descendant discovery.
   * @param signal - cancellation forwarded to and checked around each catalog read.
   * @returns children and branch diagnostics in parent-catalog pre-order.
   * @throws {@link SubagentError} when listing dependencies are unavailable or the caller cancels.
   * @throws SessionQueryError when the root catalog cannot be read.
   */
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]> {
    return listSubagentDescendants(this.ctx, rootSessionId, signal)
  }

  /**
   * Deliver one browser-authored message to a continuable child through the
   * exact live direct parent, retaining the caller-minted request identity and
   * validated browser zone on the accepted message. Success identifies the
   * message the child's inbox accepted; later execution is independent of this
   * call. Queue delivery targets a later turn; steer delivery targets the
   * nearest step and retains the Agent loop's best-effort fallback semantics.
   * Image parts are admitted and persisted through the attachment store
   * before delivery, and the child's model must accept image input.
   * Cold resume at capacity rejects with `subagent/delivery-unavailable`.
   * @param request - durable address, delivery, minted identity, content, and optional browser zone.
   * @param signal - carrier cancellation, owning the call until inbox acceptance.
   * @returns the accepted message's inbox identity.
   * @throws {RemoteError} `gateway/bad-request`, `subagent/attachment-invalid`,
   *   `subagent/invalid-time-zone`, `subagent/parent-unavailable`,
   *   `subagent/not-resumable`, `subagent/unauthorized`,
   *   `subagent/delivery-unavailable`, `gateway/cancelled`, or `gateway/internal`.
   */
  @Remote('prompt')
  async prompt(request: SubagentPromptRequest, signal: AbortSignal): Promise<SubagentPromptReceipt> {
    const { parentSessionId, childSessionId, clientTimeZone, delivery } = request
    validateControlRequest('subagent.prompt', request)
    const canonicalTimeZone = clientTimeZone === undefined
      ? undefined
      : canonicalClientTimeZone(clientTimeZone)
    if (clientTimeZone !== undefined && canonicalTimeZone === undefined) {
      throw new RemoteError(
        'subagent/invalid-time-zone',
        'clientTimeZone must be UTC or a valid IANA Area/Location name',
        { value: clientTimeZone },
      )
    }
    const parent = this.ctx.get('agents')?.get(parentSessionId)
    if (parent === undefined) {
      throw new RemoteError(
        'subagent/parent-unavailable',
        `parent session "${parentSessionId}" is not live`,
        { parentSessionId },
      )
    }
    const source: BrowserPromptSource = {
      kind: 'user',
      rpcId: request.requestId,
      ...(canonicalTimeZone === undefined ? {} : { clientTimeZone: canonicalTimeZone }),
    }
    try {
      // Admission precedes delivery: image parts become durable references
      // here, so the child inbox only ever accepts Host-persisted attachments.
      let content: ContentBlock[]
      if (request.content.every((part): part is { readonly type: 'text'; readonly text: string } => part.type === 'text')) {
        content = request.content.map(part => ({ type: 'text', text: part.text }))
      } else {
        const attachments = this.ctx.get('attachments')
        if (attachments === undefined) throw new Error('subagent image prompt requires an attachment store')
        content = await attachments.admitPromptContent(request.content)
      }
      return {
        messageId: await this[deliverSubagentPrompt](
          parent,
          childSessionId,
          content,
          source,
          signal,
          delivery,
        ),
      }
    } catch (error: unknown) {
      return rejectPrompt(error, childSessionId, signal)
    }
  }

  /**
   * Remote face of {@link interrupt} under one durable parent address. No
   * catalog, history, persistence, or parent Agent lookup runs: the core
   * primitive alone authorizes the address against the live Activation, which
   * is what keeps a live child interruptible while its parent Agent is offline.
   * Absent, idle, and already-completed targets are accepted no-ops there.
   * @param childSessionId - durable child session id to interrupt.
   * @param parentSessionId - durable direct parent whose authority is claimed.
   * @param mode - required continuable-address discriminator.
   * @returns acknowledgement that the cancel signal was admitted, not that the target is quiescent.
   * @throws {RemoteError} `gateway/bad-request` for an empty id,
   *   `subagent/unauthorized` when the address does not own the live target,
   *   otherwise `gateway/internal`.
   */
  @Remote('interruptByParent')
  interruptByParent(
    childSessionId: SessionId,
    parentSessionId: SessionId,
    mode: 'continuable',
  ): SubagentInterruptReceipt {
    validateControlRequest('subagent.interrupt', { childSessionId, parentSessionId, mode })
    try {
      this.interrupt(childSessionId, { kind: 'user', parentSessionId })
    } catch (error: unknown) {
      if (error instanceof SubagentError && error.code === 'UNAUTHORIZED') {
        throw new RemoteError(
          'subagent/unauthorized',
          'subagent does not belong to this parent',
          { childSessionId },
          { cause: error },
        )
      }
      throw new RemoteError('gateway/internal', 'subagent interrupt failed', {}, { cause: error })
    }
    return { accepted: true }
  }

  /**
   * Register a provider under its name. Registration is effect-scoped and HMR
   * safe; removing a provider blocks new starts but does not revoke runs that
   * were already returned to their holders. Providers without either execution
   * method are rejected with UNSUPPORTED_CAPABILITY before registration.
   * @param provider - the trusted provider implementation.
   * @returns the exact Cordis effect disposer.
   */
  registerProvider(provider: SubagentProvider): () => void {
    const name = provider.name
    if (provider.start === undefined && provider.prepareContinuable === undefined) {
      throw new SubagentError(`subagent provider "${name}" must implement start or prepareContinuable`, 'UNSUPPORTED_CAPABILITY')
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous disposer
    return this.ctx.effect(function* (this: SubagentRuntime) {
      if (this.providers.has(name)) {
        throw new SubagentError(`a subagent provider named "${name}" is already registered`, 'DUPLICATE_PROVIDER')
      }
      this.providers.set(name, provider)
      yield () => {
        this.providers.delete(name)
        this.emitLifecycle('subagent/provider-removed', name)
      }
      // A throwing added-listener unwinds the yielded rollback, matching the
      // repository's fail-loud registration semantics.
      this.ctx.emit('subagent/provider-added', provider)
    }.bind(this), 'subagents.registerProvider()')
  }

  /**
   * Look up a provider by name.
   * @param name - the provider name.
   * @returns the provider, or undefined when absent.
   */
  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * List registered provider names in insertion order.
   * @returns the registered names.
   */
  list(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Resolve one provider's detached continuable-creation contribution. Method
   * presence on the provider IS the capability, so a provider without it is
   * rejected before the manager reserves any child resources.
   */
  private async prepareContinuable(
    name: string,
    request: ContinuableCreateRequest,
  ): Promise<ContinuableCreateSpec> {
    const provider = this.expectProvider(name) as SubagentProvider & Required<Pick<SubagentProvider, 'prepareContinuable'>>
    return provider.prepareContinuable(request)
  }

  /** Look up a provider for dispatch or fail loud. */
  private expectProvider(name: string): SubagentProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) {
      throw new SubagentError(`no subagent provider registered for "${name}"`, 'NO_PROVIDER')
    }
    return provider
  }

  /** Resolve the subagent manager or fail loud. */
  private requireManager(): SubagentManager {
    if (this.manager === undefined) {
      throw new SubagentError(
        'continuable subagents require the agents service',
        'CONTINUATION_UNAVAILABLE',
      )
    }
    return this.manager
  }

  /**
   * Build the lifecycle observer for one continuable Activation's residency
   * epoch, so the manager publishes its edges without owning event dispatch.
   */
  private observeActivation(
    provider: string,
    childId: SessionId,
    parent: Agent,
  ): ActivationObserver {
    return createActivationObserver(this.emitLifecycle, provider, childId, parent)
  }

  /** Reject the first requested capability that the provider lacks. */
  private assertCapabilities(provider: SubagentProvider, request: SubagentStartRequest): void {
    const needs: { when: boolean; cap: keyof SubagentCapabilities }[] = [
      { when: request.agentOptions !== undefined, cap: 'agentOptions' },
      { when: request.outputSchema !== undefined, cap: 'outputSchema' },
      { when: request.maxDepth !== undefined, cap: 'depthLimit' },
      { when: request.toolFilter !== undefined, cap: 'toolFilter' },
      { when: request.persona !== undefined, cap: 'persona' },
    ]
    for (const { when, cap } of needs) {
      if (when && !provider.capabilities[cap]) {
        throw new SubagentError(
          `subagent provider "${provider.name}" does not support the "${cap}" capability`,
          'UNSUPPORTED_CAPABILITY',
        )
      }
    }
  }
}

export default SubagentRuntime

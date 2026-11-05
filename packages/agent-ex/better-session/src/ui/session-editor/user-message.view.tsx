// user / steering 两条消息行：替掉官方内置渲染（keyed 位置同 key + 更低 priority 即替换）。
//
// 动作行只有编辑（撤回回填）与重试：都是针对**这条消息**的编辑动作。分叉不在这一行——它的语义是
// "以某个边界把会话复制一份"，属于**回合末尾**（turn-end）那处的动作，由上游 `TurnTailNodeView` 的
// `onBranch` 提供；在这里再挂一个是重复入口（用户报的就是这个）。
import {
  Button,
  IconButton,
  IconEditOutlineRegular,
  IconRefreshOutlineRegular,
  Modal,
  Row,
  Stack,
} from "@morlay/zephyr-ui";
import type {
  ChatNodeOwnerProps,
  ChatNodeViewProps,
  UserContentAttachment,
  UserContentData,
  UserMessageNode,
} from "@morlay/dsh-conversation/contract";
import type { UserTextFacts } from "@morlay/dsh-conversation/contract";
import type { InjectFace, PropsRenderFactories } from "@morlay/zephyr-ui";
import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MessageIconActions } from "../vendor/dsh-client-ui-chat/client/chat/MessageIconActions.tsx";
import type { EditableMessageBlock, SessionEditorFace } from "./session-editor.contract.ts";

type UserImage = Extract<UserMessageNode["content"][number], { type: "image" }>;

// 内容拆成工厂要的三份：文本、按原顺序的附件、其余块。呈现（含图片槽）归工厂。
function contentParts(content: readonly unknown[]): {
  text: string;
  texts: string[];
  attachments: UserContentAttachment[];
  rest: unknown[];
} {
  const texts: string[] = [];
  const attachments: UserContentAttachment[] = [];
  const rest: unknown[] = [];
  for (const block of content) {
    const value = block as { type?: string; text?: string; attachment?: unknown };
    if (value.type === "text" && typeof value.text === "string") texts.push(value.text);
    else if (value.type === "image" && value.attachment !== undefined) {
      attachments.push({ type: "image", image: { attachment: (block as UserImage).attachment } });
    } else rest.push(block);
  }
  // 多块消息按空行拼回 raw markdown；撤回回填用的是 texts（全部块）。
  return { text: texts.join("\n\n"), texts, attachments, rest };
}

function UserStyleBubble({
  content,
  referenceLabels,
  skillNames,
  loadImage,
  renderFactorySlot,
  actions,
}: {
  content: readonly unknown[];
  referenceLabels?: readonly string[] | undefined;
  skillNames?: readonly string[] | undefined;
  loadImage: ChatNodeOwnerProps["loadImage"];
  renderFactorySlot: PropsRenderFactories["renderFactorySlot"];
  actions?: ((text: string) => ReactNode) | undefined;
}): ReactNode {
  const parts = useMemo(() => contentParts(content), [content]);
  const prepared = useMemo<UserContentData>(
    () => ({
      text: parts.text,
      attachments: parts.attachments,
      extraBlocks: parts.rest,
      ...(referenceLabels === undefined ? {} : { referenceLabels }),
    }),
    [parts, referenceLabels],
  );
  const facts = useMemo<Readonly<Partial<UserTextFacts>>>(
    () => ({
      ...(referenceLabels === undefined ? {} : { sessionLabels: referenceLabels }),
      ...(skillNames === undefined ? {} : { skillNames }),
    }),
    [referenceLabels, skillNames],
  );
  return (
    <Stack align="end" gap={6} data-time-hover-root="">
      {/* 内容整块交回上游工厂 `conversation.chat.user.content`：附件（含图片槽）、文本与引用呈现都归它，
          那个槽的声明权在工厂手里，自己渲染会被拒。这里只保留自己的动作行。 */}
      {renderFactorySlot("conversation.chat.user.content", {
        content: prepared,
        loadImage,
        facts,
        interactive: true,
      })}
      {actions === undefined ? null : actions(prepared.text)}
    </Stack>
  );
}

type Props = ChatNodeViewProps<"user" | "steering"> & InjectFace<SessionEditorFace>;

export const UserMessageNodeView = memo(function UserMessageNodeView({
  node,
  t,
  loadImage,
  renderFactorySlot,
  recall,
  retry,
  editorT,
}: Props): ReactNode {
  const data = node.data;
  // 撤回回填的文本：该消息的全部文本块（撤回截断整条消息，只回填首块会丢内容）。
  const recallTexts = contentParts(data.content).texts;
  const [confirmingRecall, setConfirmingRecall] = useState<EditableMessageBlock | null>(null);
  const [confirmingRetry, setConfirmingRetry] = useState(false);

  const turnLocation =
    node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn : undefined;
  const turn = turnLocation?.turn;
  // 重试只对已闭合轮次开放（未闭合 / 无闭合边界的轮次服务端无法重放）。
  const retryable = turnLocation?.status === "closed";
  // 编辑目标：第一个文本块（与时间线编辑面的 blockIndex 对齐）。
  const textBlockIndex = data.content.findIndex(
    (block) => (block as { type?: string }).type === "text",
  );
  const textBlock =
    textBlockIndex === -1 ? undefined : (data.content[textBlockIndex] as { text?: string });
  // 编辑（撤回）只要求存在可编辑文本块：轮外消息同样可撤回，服务端按消息自身位置截断。
  const onEdit =
    textBlock === undefined
      ? undefined
      : (): void => {
          setConfirmingRecall({
            key: node.anchorSeq + ":" + String(textBlockIndex),
            ...(turn === undefined ? {} : { turn }),
            eventSeq: node.anchorSeq,
            blockIndex: textBlockIndex,
            kind: "user",
            text: textBlock.text ?? "",
            time: data.time,
          });
        };
  // 重试先弹确认（会抛弃该回合及其后的内容）。
  const onRetry =
    retryable && turn !== undefined
      ? (): void => {
          setConfirmingRetry(true);
        }
      : undefined;
  return (
    <>
      {confirmingRecall === null ? null : (
        <Modal
          open
          onClose={() => {
            setConfirmingRecall(null);
          }}
          title={editorT("edit.title")}
          closeLabel={editorT("cancel")}
          description={editorT("edit.description")}
          footer={
            <Row gap={8} justify="end">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmingRecall(null);
                }}
              >
                {editorT("cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const target = confirmingRecall;
                  setConfirmingRecall(null);
                  void recall(target, recallTexts);
                }}
              >
                {editorT("edit.confirm")}
              </Button>
            </Row>
          }
        />
      )}
      {!confirmingRetry || turn === undefined ? null : (
        <Modal
          open
          onClose={() => {
            setConfirmingRetry(false);
          }}
          title={editorT("retry.title")}
          closeLabel={editorT("cancel")}
          description={editorT("retry.description", { turn })}
          footer={
            <Row gap={8} justify="end">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmingRetry(false);
                }}
              >
                {editorT("cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmingRetry(false);
                  void retry(turn, "truncate");
                }}
              >
                {editorT("retry.confirm")}
              </Button>
            </Row>
          }
        />
      )}
      <UserStyleBubble
        content={data.content}
        {...(data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels })}
        {...(data.skillNames === undefined ? {} : { skillNames: data.skillNames })}
        loadImage={loadImage}
        renderFactorySlot={renderFactorySlot}
        actions={(text) => (
          <MessageIconActions
            text={text}
            time={data.time}
            clock="start"
            t={t}
            extraActions={
              <>
                {onEdit === undefined ? null : (
                  <IconButton shape="circle" label={editorT("edit")} onClick={onEdit}>
                    <IconEditOutlineRegular />
                  </IconButton>
                )}
                {onRetry === undefined ? null : (
                  <IconButton shape="circle" label={editorT("retry")} onClick={onRetry}>
                    <IconRefreshOutlineRegular />
                  </IconButton>
                )}
              </>
            }
          />
        )}
      />
    </>
  );
});

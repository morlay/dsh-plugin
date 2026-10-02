// MessageItem: 替换官方内置的 `user` / `steering` 两个 chat-node 渲染器（keyed slot reuse 即替换），
// 在消息动作行上提供 edit / retry；其余 key 由官方内置渲染器处理。

import {
  Bubble,
  Button,
  IconButton,
  IconEditOutlineRegular,
  IconRefreshOutlineRegular,
  JsonBlock,
  markdownLabels,
  Modal,
  ReferenceMarkdown,
  Row,
  Stack,
  type ReferenceActions,
} from "@morlay/dsh-client-ui-primitives/client";
import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { UserMessageNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ChatNodeViewProps, ChatViewSlotProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { RenderMessageImages } from "@deepseek-ai/dsh-client-ui-conversation/client";
// 动作行整条用上游那份：复制 / 分支 / 时间标签的悬停显形都归它，我们只经它的 `extraActions` 注入自己的两个入口。
// 走 vendor 源码的相对路径（与 `dsh-subagent` 接上游源码同一种写法），不经包出口。
import { MessageIconActions } from "../../../../../../vendor/deepseek-harness/packages/client/ui-chat/src/client/chat/MessageIconActions.tsx";
import type { EditableMessageBlock } from "../../shared.ts";
import type { SessionEditorFace } from "../controller.ts";

type UserImage = Extract<UserMessageNode["content"][number], { type: "image" }>;

function contentParts(content: readonly unknown[]): {
  text: string;
  texts: string[];
  images: { attachment: UserImage["attachment"] }[];
  rest: unknown[];
} {
  const texts: string[] = [];
  const images: { attachment: UserImage["attachment"] }[] = [];
  const rest: unknown[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown };
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "image" && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment });
    } else rest.push(block);
  }
  // 多块消息按空行拼回 raw markdown（新式提交就是单块原文）；撤回回填用的是 texts（全部块）。
  return { text: texts.join("\n\n"), texts, images, rest };
}

function UserStyleBubble({
  content,
  renderMessageImages,
  actions,
  references,
  t,
}: {
  content: readonly unknown[];
  renderMessageImages: RenderMessageImages;

  actions?: (text: string) => ReactNode;
  // 引用 chip 的点击目标（owner props；缺省时 chip 照常渲染但点击无效果）。
  references?: ReferenceActions | undefined;
  t: ChatViewSlotProps["t"];
}): ReactNode {
  const { text, images, rest } = contentParts(content);
  const truncated = (total: number): string => t("json.truncated", { total });
  // labels 按 locale revision 稳定（官方 MarkdownText 在它上面 memo 渲染缓存）。
  const labels = useMemo(() => markdownLabels(t), [t]);
  const showBubble = text !== "" || rest.length > 0;
  return (
    <Stack align="end" gap={6} data-time-hover-root>
      <Stack align="end" gap={8} narrow>
        {renderMessageImages({ images, align: "end" })}
        {showBubble && (
          <Bubble>
            <ReferenceMarkdown text={text} labels={labels} actions={references} />
            {rest.map((block, i) => (
              <JsonBlock
                key={i}
                label={t("message.extraBlock")}
                payload={block}
                truncatedLabel={truncated}
              />
            ))}
          </Bubble>
        )}
      </Stack>
      {actions?.(text)}
    </Stack>
  );
}

export const UserMessageNodeView = memo(function UserMessageNodeView({
  node,
  renderMessageImages,
  t,
  openFile,
  openSkill,
  recall,
  retry,
}: ChatNodeViewProps<"user" | "steering"> & {
  // keyed 渲染器由 owner props 展开调用：引用 chip 的点击目标从这里来。
  openFile: (path: string) => void;
  openSkill: (name: string) => void;
} & InjectFace<SessionEditorFace>) {
  const data = node.data;
  // 撤回回填的文本：该消息的全部文本块（撤回截断整条消息，只回填首块会丢内容）。
  const recallTexts = contentParts(data.content).texts;
  const [confirmingRecall, setConfirmingRecall] = useState<EditableMessageBlock | null>(null);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const turnLocation =
    node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn : undefined;
  const turn = turnLocation?.turn;
  // 重试只对已闭合轮次开放（未闭合/无闭合边界的轮次服务端无法重放）。
  const retryable = turnLocation?.status === "closed";
  // 编辑目标：第一个文本块（与 Timeline 编辑面的 blockIndex 对齐）。
  const textBlockIndex = data.content.findIndex(
    (block) => (block as { type?: string }).type === "text",
  );
  const textBlock =
    textBlockIndex === -1 ? undefined : (data.content[textBlockIndex] as { text?: string });
  // 编辑（撤回）只要求存在可编辑文本块：轮外消息（location 无 turn/step
  // 归属）同样可撤回——服务端按消息自身位置截断，不依赖轮次边界。
  const onEdit =
    textBlock === undefined
      ? undefined
      : () => {
          setConfirmingRecall({
            key: `${node.anchorSeq}:${String(textBlockIndex)}`,
            ...(turn === undefined ? {} : { turn }),
            eventSeq: node.anchorSeq,
            blockIndex: textBlockIndex,
            kind: "user",
            text: textBlock.text ?? "",
            time: data.time,
          });
        };
  // 重试先弹确认（就地编辑会抛弃该回合及其后的内容）。
  const onRetry =
    retryable && turn !== undefined
      ? () => {
          setConfirmingRetry(true);
        }
      : undefined;
  return (
    <>
      {confirmingRecall !== null && (
        <Modal
          open
          onClose={() => setConfirmingRecall(null)}
          title="编辑消息"
          closeLabel="关闭"
          description="将撤回该消息及其之后的对话内容到输入框，请修改后重新发送。"
          footer={
            <Row gap={8} justify="end">
              <Button variant="outline" onClick={() => setConfirmingRecall(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const target = confirmingRecall;
                  setConfirmingRecall(null);
                  void recall(target, recallTexts);
                }}
              >
                撤回并编辑
              </Button>
            </Row>
          }
        />
      )}
      {confirmingRetry && turn !== undefined && (
        <Modal
          open
          onClose={() => setConfirmingRetry(false)}
          title="重试回合"
          closeLabel="关闭"
          description={`将重新生成第 ${turn} 轮的回复，并抛弃该回合之后的内容。`}
          footer={
            <Row gap={8} justify="end">
              <Button variant="outline" onClick={() => setConfirmingRetry(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmingRetry(false);
                  void retry(turn, "truncate");
                }}
              >
                确认重试
              </Button>
            </Row>
          }
        />
      )}
      <UserStyleBubble
        content={data.content}
        renderMessageImages={renderMessageImages}
        references={{ openFile, openSkill }}
        t={t}
        actions={(text) => (
          <MessageIconActions
            text={text}
            time={data.time}
            clock="start"
            t={t}
            extraActions={
              <>
                {onEdit === undefined ? null : (
                  <IconButton shape="circle" label="编辑" onClick={onEdit}>
                    <IconEditOutlineRegular />
                  </IconButton>
                )}
                {onRetry === undefined ? null : (
                  <IconButton shape="circle" label="重试此回合" onClick={onRetry}>
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

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "../AgentAvatar";
import { useAgentAvatarDisplay } from "../../hooks/use-agent-avatar-display";
import { cn } from "../../lib/utils";
import type { MessageReactionSentiment } from "../../hooks/use-chat";
import { formatChatTime } from "./formatTime";
import { getCopyableTextForItem } from "./model";
import type { ChatRenderableItem } from "./types";
import { StandardChatMessageBody } from "./StandardChatMessageBody";
import { ChatMessageHoverToolbar } from "./ChatMessageHoverToolbar";

export function ChatMessageItem({
  item,
  messageReactions = {},
  onMessageReaction,
}: {
  item: ChatRenderableItem;
  messageReactions?: Record<string, MessageReactionSentiment>;
  onMessageReaction?: (
    messageId: string,
    reaction: MessageReactionSentiment | "none",
  ) => void | Promise<void>;
}) {
  const { meta, isGrouped, messageId } = item;
  const isUser = meta.role === "user";
  const copyText = getCopyableTextForItem(item);
  const showCopyAction = copyText.length > 0;
  const showReactionActions = !!onMessageReaction;

  const currentReaction = messageReactions[messageId];
  const [copied, setCopied] = useState(false);
  const rawAgentName = item.event?.meta?.agentName;
  const avatar = useAgentAvatarDisplay(rawAgentName, isUser);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyFeedbackTimeoutRef.current = null;
      }, 2000);
    });
  };

  return (
    <div
      className={cn(
        "group flex flex-col w-full hover:bg-muted/10 transition-colors duration-75 relative px-5",
        isGrouped ? "py-0.5" : "py-2 mt-2",
      )}
    >
      <ChatMessageHoverToolbar
        messageId={messageId}
        showCopy={showCopyAction}
        showReactions={showReactionActions}
        copied={copied}
        onCopy={handleCopy}
        currentReaction={currentReaction}
        onMessageReaction={onMessageReaction}
      />

      <div className="flex w-full items-start gap-3">
        <div className="w-[36px] shrink-0">
          {!isGrouped && (
            <AgentAvatar
              name={avatar.name}
              label={avatar.label}
              imageUrl={avatar.imageUrl}
              className="size-8 rounded-md"
            />
          )}
          {isGrouped && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground/60 text-right mt-1.5 pr-1 font-medium">
              {formatChatTime(meta.timestamp).split(" ")[0]}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground cursor-pointer">
                {avatar.label}
              </span>
              <span className="text-xs text-muted-foreground/60">
                {formatChatTime(meta.timestamp)}
              </span>
            </div>
          )}

          <div className="text-[15px] leading-[1.46668] text-foreground/90">
            <StandardChatMessageBody event={item.event!} />
          </div>
        </div>
      </div>
    </div>
  );
}

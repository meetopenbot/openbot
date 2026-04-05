import {
  Check,
  Copy,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "../../lib/utils";
import type { MessageReactionSentiment } from "../../hooks/use-chat";

type Props = {
  messageId: string;
  showCopy: boolean;
  showReactions: boolean;
  copied: boolean;
  onCopy: () => void;
  currentReaction?: MessageReactionSentiment;
  onMessageReaction?: (
    messageId: string,
    reaction: MessageReactionSentiment | "none",
  ) => void | Promise<void>;
};

export function ChatMessageHoverToolbar({
  messageId,
  showCopy,
  showReactions,
  copied,
  onCopy,
  currentReaction,
  onMessageReaction,
}: Props) {
  const visible = showCopy || showReactions;
  if (!visible) return null;

  return (
    <div
      className={cn(
        "absolute top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-background border border-border/50 rounded-lg shadow-sm p-0.5 z-10 right-5",
      )}
    >
      {showCopy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopy();
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label={copied ? "Copied" : "Copy message"}
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {copied ? "Copied!" : "Copy message"}
          </TooltipContent>
        </Tooltip>
      )}
      {showReactions && onMessageReaction && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const next = currentReaction === "like" ? "none" : "like";
                  void onMessageReaction(messageId, next);
                }}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  currentReaction === "like" &&
                    "text-primary hover:text-primary",
                )}
                aria-label={
                  currentReaction === "like" ? "Remove like" : "Like message"
                }
                aria-pressed={currentReaction === "like"}
              >
                <ThumbsUp className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {currentReaction === "like" ? "Remove like" : "Like"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const next =
                    currentReaction === "dislike" ? "none" : "dislike";
                  void onMessageReaction(messageId, next);
                }}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  currentReaction === "dislike" &&
                    "text-destructive hover:text-destructive",
                )}
                aria-label={
                  currentReaction === "dislike"
                    ? "Remove dislike"
                    : "Dislike message"
                }
                aria-pressed={currentReaction === "dislike"}
              >
                <ThumbsDown className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {currentReaction === "dislike" ? "Remove dislike" : "Dislike"}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

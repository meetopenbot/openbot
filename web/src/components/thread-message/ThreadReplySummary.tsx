type Props = {
  replyCount: number;
  messageId: string;
  onReply: (messageId: string) => void;
};

export function ThreadReplySummary({
  replyCount,
  messageId,
  onReply,
}: Props) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReply(messageId);
      }}
      className="mt-2 flex items-center gap-2 text-[13px] font-medium text-primary hover:cursor-pointer group/thread"
    >
      <div className="flex -space-x-1.5">
        <div className="size-5 rounded bg-primary/10 border border-background flex items-center justify-center text-[8px]">
          {replyCount}
        </div>
      </div>
      <span>
        {replyCount} {replyCount === 1 ? "reply" : "replies"}
      </span>
      <span className="opacity-0 group-hover/thread:opacity-100 transition-opacity text-muted-foreground text-[11px] font-normal">
        View thread
      </span>
    </button>
  );
}

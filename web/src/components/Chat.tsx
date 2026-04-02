import { useChat } from "../hooks/use-chat";
import { type ReactNode } from "react";
import { ThreadView } from "./ThreadView";

export function Chat({
  placeholder,
  placeholderNode,
  onReply,
}: {
  placeholder?: ReactNode;
  placeholderNode?: any;
  onReply?: (messageId: string) => void;
}) {
  const { messages, streaming, threadReplyCounts, messageReactions, setMessageReaction } =
    useChat();

  return (
    <ThreadView
      messages={messages}
      streaming={streaming}
      placeholder={placeholder}
      placeholderNode={placeholderNode}
      onReply={onReply}
      threadReplyCounts={threadReplyCounts}
      messageReactions={messageReactions}
      onMessageReaction={setMessageReaction}
    />
  );
}

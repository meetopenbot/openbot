import { useChat } from "../hooks/use-chat";
import { type ReactNode } from "react";
import { ThreadView } from "./ThreadView";

export function Thread({
  placeholder,
  placeholderNode,
  onReply,
}: {
  placeholder?: ReactNode;
  placeholderNode?: any;
  onReply?: (messageId: string) => void;
}) {
  const { messages, streaming, threads } = useChat();

  return (
    <ThreadView
      messages={messages}
      streaming={streaming}
      placeholder={placeholder}
      placeholderNode={placeholderNode}
      onReply={onReply}
      threads={threads}
    />
  );
}

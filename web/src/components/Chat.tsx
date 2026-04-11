import { useChat } from "../hooks/use-chat";
import { type ReactNode } from "react";
import { ChatView } from "./ChatView";

export function Chat({
  placeholder,
  placeholderNode,
}: {
  placeholder?: ReactNode;
  placeholderNode?: any;
}) {
  const { messages, streaming, activeAgentId, messageReactions, setMessageReaction } =
    useChat();

  return (
    <ChatView
      messages={messages}
      streaming={streaming}
      activeAgentId={activeAgentId}
      placeholder={placeholder}
      placeholderNode={placeholderNode}
      messageReactions={messageReactions}
      onMessageReaction={setMessageReaction}
    />
  );
}

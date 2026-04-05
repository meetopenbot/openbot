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
  const { messages, streaming, messageReactions, setMessageReaction } =
    useChat();

  return (
    <ChatView
      messages={messages}
      streaming={streaming}
      placeholder={placeholder}
      placeholderNode={placeholderNode}
      messageReactions={messageReactions}
      onMessageReaction={setMessageReaction}
    />
  );
}

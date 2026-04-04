import { foldThreadEventsToMessages, useChat } from "../hooks/use-chat";
import { ThreadView } from "./ThreadView";
import { Composer } from "./Composer";

export function ThreadPanel({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const { messages, threads, streaming, messageReactions, setMessageReaction } =
    useChat(threadId);

  const parentMessage = messages.find(m => m.id === threadId);

  const parentAgentName = parentMessage?.role === "assistant"
    ? parentMessage.content?.find((e: any) => e.meta?.agentName)?.meta?.agentName as string | undefined
    : undefined;

  const threadEvents = threads[threadId] || [];
  
  const threadMessages = foldThreadEventsToMessages(threadEvents);

  return (
    <div className="flex flex-col h-full bg-background border-l border-border/50 animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
        <div className="flex flex-col">
           <h3 className="text-sm font-bold text-foreground">Thread</h3>
           <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
             {parentMessage?.role === 'user' ? 'Your message' : 'Agent response'}
           </p>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* Parent Message (Context) */}
      <div className="flex-1 overflow-auto px-2">
        <div className="border-b border-border/30 pb-2">
           {parentMessage && (
             <ThreadView 
                messages={[parentMessage]} 
                isThreadPanel 
                messageReactions={messageReactions}
                onMessageReaction={setMessageReaction}
             />
           )}
        </div>

        {/* Thread Replies */}
        <div className="bg-muted/5">
           <ThreadView 
              messages={threadMessages} 
              streaming={streaming}
              isThreadPanel 
              messageReactions={messageReactions}
              onMessageReaction={setMessageReaction}
           />
        </div>
      </div>

      {/* Composer */}
      <div className="p-4 pt-0">
        <Composer threadId={threadId} threadAgentName={parentAgentName} />
      </div>
    </div>
  );
}

import { useMelony } from "@melony/react";
import { MelonyRenderer, type UINode } from "@melony/ui-kit";
import { useEffect, useRef, type ReactNode } from "react";

const TEXT_EVENT_TYPES = new Set([
  "assistant:text",
  "manager:completion",
  "assistant:text-delta",
  "user:text",
]);

function hasRenderableContent(message: { content: any[] }): boolean {
  return message.content.some((event: any) => event.type === "ui" || TEXT_EVENT_TYPES.has(event.type));
}

function StreamingIndicator() {
  return (
    <div className="flex items-start w-full animate-fade-in">
      <div className="flex items-center gap-1.5 px-1 py-3">
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  );
}

export function Thread({
  placeholder,
  placeholderNode,
}: {
  placeholder?: ReactNode;
  placeholderNode?: UINode;
}) {
  const { messages, streaming } = useMelony();
  const bottomRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages
    .filter((m) => m.role !== "system")
    .filter(hasRenderableContent);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages, streaming]);

  if (visibleMessages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] py-12 gap-8">
        <div className="flex flex-col gap-3">
          {placeholder}
          {!placeholder && placeholderNode && <MelonyRenderer node={placeholderNode} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 gap-5 w-full py-6 px-4">
      {visibleMessages.map((msg, index) => (
        <div
          key={`${msg.runId}-${index}`}
          className={`flex flex-col w-full animate-fade-in ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
        >
          <div className={`max-w-[85%] rounded-2xl ${msg.role === 'user'
            ? 'px-4 py-3 bg-foreground/4 border border-border/40'
            : ''
          }`}>
            {(() => {
              let lastText = "";

              return (
                <div className="flex flex-col gap-3">
                  {msg.content.map((event: any, i: number) => {
                    if (event.type === "ui") {
                      return <MelonyRenderer key={`${msg.runId}-ui-${i}`} node={event.data} />;
                    }

                    if (TEXT_EVENT_TYPES.has(event.type)) {
                      const isLastInSequence = !TEXT_EVENT_TYPES.has(msg.content[i + 1]?.type);
                      if (!isLastInSequence) return null;

                      const fullText = event.data?.content || "";
                      const displayContent = fullText.startsWith(lastText) 
                        ? fullText.slice(lastText.length) 
                        : fullText;
                      
                      lastText = fullText;
                      
                      if (!displayContent) return null;

                      return (
                        <div key={`${msg.runId}-text-${i}`} className={msg.role === 'user' ? 'text-[13px] leading-relaxed' : ''}>
                          <MelonyRenderer node={{ type: "markdown", props: { value: displayContent, size: "sm" } } as any} />
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      ))}
      {streaming && <StreamingIndicator />}
      <div ref={bottomRef} className="h-0" />
    </div>
  );
}

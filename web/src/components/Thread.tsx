import { useMelony } from "@melony/react";
import { MelonyRenderer, type UINode } from "@melony/ui-kit";
import { useEffect, useRef, type ReactNode } from "react";

const TEXT_EVENT_TYPES = new Set([
  "assistant:text",
  "manager:completion",
  "user:text",
]);

function hasRenderableContent(message: { content: any[] }): boolean {
  return message.content.some((event: any) => (
    event.type === "ui" ||
    TEXT_EVENT_TYPES.has(event.type) ||
    event.type === "user:multimodal"
  ));
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
  const renderableEvents = visibleMessages.flatMap((msg, msgIndex) =>
    msg.content
      .map((event: any, eventIndex: number) => ({ msg, msgIndex, event, eventIndex }))
      .filter(({ event }) => (
        event.type === "ui" ||
        TEXT_EVENT_TYPES.has(event.type) ||
        event.type === "user:multimodal"
      ))
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [renderableEvents, streaming]);

  if (renderableEvents.length === 0) {
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
      {renderableEvents.map(({ msg, event, eventIndex, msgIndex }) => {
        const isUserEvent = typeof event?.type === "string" && event.type.startsWith("user:");

        if (event.type === "ui") {
          return (
            <div
              key={`${msg.runId}-${msgIndex}-ui-${eventIndex}`}
              className="flex flex-col w-full items-start animate-fade-in"
            >
              <div className="max-w-[85%]">
                <MelonyRenderer node={event.data} />
              </div>
            </div>
          );
        }

        if (TEXT_EVENT_TYPES.has(event.type)) {
          const content = typeof event.data?.content === "string" ? event.data.content : "";
          if (!content) return null;

          return (
            <div
              key={`${msg.runId}-${msgIndex}-text-${eventIndex}`}
              className={`flex flex-col w-full animate-fade-in ${isUserEvent ? "items-end" : "items-start"}`}
            >
              <div className={`max-w-[85%] rounded-2xl ${isUserEvent ? "px-4 py-3 bg-foreground/4 border border-border/40" : ""}`}>
                <div className={isUserEvent ? "text-[13px] leading-relaxed" : ""}>
                  <MelonyRenderer node={{ type: "markdown", props: { value: content, size: "sm" } } as any} />
                </div>
              </div>
            </div>
          );
        }

        if (event.type === "user:multimodal") {
          const content = typeof event.data?.content === "string" ? event.data.content : "";
          const attachments = Array.isArray(event.data?.attachments) ? event.data.attachments : [];
          if (!content && attachments.length === 0) return null;

          return (
            <div
              key={`${msg.runId}-${msgIndex}-multimodal-${eventIndex}`}
              className="flex flex-col w-full animate-fade-in items-end"
            >
              <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-foreground/4 border border-border/40">
                <div className="flex flex-col gap-2">
                  {content && (
                    <div className="text-[13px] leading-relaxed">
                      <MelonyRenderer node={{ type: "markdown", props: { value: content, size: "sm" } } as any} />
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((attachment: any) => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-border/60"
                        >
                          <img
                            src={attachment.url}
                            alt={attachment.name || "attachment"}
                            className="h-40 w-40 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        return null;
      })}
      {streaming && <StreamingIndicator />}
      <div ref={bottomRef} className="h-0" />
    </div>
  );
}

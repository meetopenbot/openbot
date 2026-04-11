import { WidgetRenderer } from "../WidgetRenderer";

/** Body for a single timeline event. */
export function StandardChatMessageBody({ event }: { event: any }) {
  if (event.type === "agent:handoff") {
    const d = event.data ?? {};
    const from = typeof d.fromAgentId === "string" ? d.fromAgentId : "?";
    const to = typeof d.toAgentId === "string" ? d.toAgentId : "?";
    const body = typeof d.content === "string" ? d.content : "";
    return (
      <div className="rounded-md border border-border/50 bg-muted/25 px-3 py-2 text-[13px] text-foreground/90 whitespace-pre-wrap">
        <span className="text-muted-foreground">Handoff</span>{" "}
        <span className="font-semibold text-foreground">@{from}</span>
        <span className="text-muted-foreground"> → </span>
        <span className="font-semibold text-foreground">@{to}</span>
        {body ? (
          <>
            {"\n\n"}
            {body}
          </>
        ) : null}
      </div>
    );
  }

  if (event.type === "ui") {
    return (
      <WidgetRenderer block={event.data} eventMeta={event.meta} />
    );
  }

  const rawContent =
    event.data?.content ?? event.data?.result ?? event.data?.message;
  const attachments = Array.isArray(event.data?.attachments)
    ? event.data.attachments
    : [];
  const isBlock =
    typeof rawContent === "object" && rawContent?.type === "ui-block";

  return (
    <div className="flex flex-col gap-2">
      {rawContent && (
        <div className="max-w-full">
          {isBlock ? (
            <WidgetRenderer block={rawContent as any} />
          ) : (
            <WidgetRenderer
              block={
                {
                  type: "ui-block",
                  widget: "text",
                  props: {
                    value:
                      typeof rawContent === "string"
                        ? rawContent
                        : JSON.stringify(rawContent, null, 2),
                  },
                  placement: "inline",
                } as any
              }
            />
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attachments.map((attachment: any) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border border-border/40 hover:border-border/60 transition-colors"
            >
              <img
                src={attachment.url}
                alt={attachment.name || "attachment"}
                className="max-h-80 w-auto object-contain bg-muted/20"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

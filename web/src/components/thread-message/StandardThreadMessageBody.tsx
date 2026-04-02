import { WidgetRenderer } from "../WidgetRenderer";

/** Main-thread body for a single standard (non-delegation) timeline event. */
export function StandardThreadMessageBody({ event }: { event: any }) {
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
                  placement: "thread",
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

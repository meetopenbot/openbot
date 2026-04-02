import { MessageMarkdown } from "../MessageMarkdown";
import { WidgetRenderer } from "../WidgetRenderer";

/** Renders a single stream event inside an expanded delegation card. */
export function ThreadStreamEventItem({ event }: { event: any }) {
  const type = event.type;
  const data = event.data;

  switch (type) {
    case "browser:status":
      return (
        <div className="flex items-center gap-2 py-0.5 px-2 hover:bg-muted/40 rounded transition-colors group">
          <div className="size-1 rounded-full bg-primary/40 group-hover:bg-primary/60 shrink-0" />
          <span className="text-[11px] leading-relaxed text-foreground/60 truncate">
            {data?.message}
          </span>
        </div>
      );
    case "browser:screenshot":
      return (
        <div className="my-2">
          <div className="relative group overflow-hidden rounded-lg border border-border/40 bg-muted/20 inline-block">
            <img
              src={data?.url}
              alt="Browser Screenshot"
              className="max-w-full h-auto object-cover max-h-60"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <a
                href={data?.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-white font-medium bg-black/60 px-2 py-1 rounded"
              >
                View Full
              </a>
            </div>
          </div>
        </div>
      );
    case "agent:output":
    case "agent:output-delta": {
      const rawContent =
        typeof data === "string"
          ? data
          : (data?.content ?? data?.result ?? data?.message);
      if (!rawContent) return null;

      if (typeof rawContent === "object" && rawContent.type === "ui-block") {
        return (
          <div className="py-1">
            <WidgetRenderer block={rawContent as any} />
          </div>
        );
      }

      const content =
        typeof rawContent === "string"
          ? rawContent
          : JSON.stringify(rawContent, null, 2);

      return (
        <div className="py-0.5">
          <WidgetRenderer
            block={{
              type: "ui-block",
              widget: "text",
              props: { value: content },
              placement: "thread",
            }}
          />
        </div>
      );
    }
    case "ui":
      if (data?.placement === "sidebar" || data?.placement === "attention")
        return null;
      return (
        <div className="py-1">
          <WidgetRenderer block={data} eventMeta={event.meta} />
        </div>
      );
    case "agent:sub-action":
      return (
        <div className="flex items-center gap-2 py-0.5 px-2 text-[10px] text-muted-foreground/60 italic">
          <div className="size-1 rounded-full bg-muted-foreground/20" />
          <span>{data?.originalType || data?.action}</span>
        </div>
      );
    default:
      if (data && typeof data === "object" && (data.message || data.content)) {
        const displayValue = data.message || data.content;
        const isBlock =
          typeof displayValue === "object" && displayValue.type === "ui-block";

        return (
          <div className="flex items-start gap-2 py-0.5 px-2">
            <div className="mt-1.5 size-1 rounded-full bg-muted-foreground/10 shrink-0" />
            <div className="text-[11px] text-muted-foreground/70">
              {isBlock ? (
                <WidgetRenderer block={displayValue} />
              ) : typeof displayValue === "string" ? (
                <MessageMarkdown>{displayValue}</MessageMarkdown>
              ) : (
                JSON.stringify(displayValue, null, 2)
              )}
            </div>
          </div>
        );
      }
      return null;
  }
}

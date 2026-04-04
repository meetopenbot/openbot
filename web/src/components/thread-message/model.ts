import { TEXT_EVENT_TYPES } from "./constants";
import type { ThreadRenderableItem } from "./types";

/** Plain text for clipboard from one timeline row. */
export function getCopyableTextForItem(
  item: Pick<ThreadRenderableItem, "event">,
): string {
  const event = item.event;
  if (!event) return "";

  if (event.type === "ui") {
    const d = event.data;
    if (d?.props?.value != null) return String(d.props.value);
    if (d?.props?.content != null) return String(d.props.content);
    try {
      return JSON.stringify(d, null, 2);
    } catch {
      return "";
    }
  }

  const raw =
    event.data?.content ?? event.data?.result ?? event.data?.message;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw.type === "ui-block") {
    const p = (raw as { props?: { value?: unknown } }).props;
    if (p?.value != null) return String(p.value);
    return JSON.stringify(raw, null, 2);
  }
  return JSON.stringify(raw, null, 2);
}

export function hasRenderableContent(message: { content: any }): boolean {
  if (typeof message.content === "string") {
    return message.content.length > 0;
  }
  if (!Array.isArray(message.content)) return false;
  return message.content.some((event: any) => {
    if (
      event.type === "ui" &&
      event.data?.placement !== "sidebar" &&
      event.data?.placement !== "attention"
    ) {
      return true;
    }
    if (TEXT_EVENT_TYPES.has(event.type)) {
      if (event.type === "agent:input") return true;
      const rawContent =
        event.data?.content ?? event.data?.result ?? event.data?.message;
      const delta = event.data?.delta;
      if (!rawContent && !delta) return false;
      if (typeof rawContent === "string" && !rawContent.trim() && !delta)
        return false;
      return true;
    }
    return false;
  });
}

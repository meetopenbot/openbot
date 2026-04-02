import { DELEGATION_EVENT_TYPES, TEXT_EVENT_TYPES } from "./constants";
import type { ThreadRenderableItem } from "./types";

/** Plain text for clipboard from one timeline row (standard event or delegation card). */
export function getCopyableTextForItem(
  item: Pick<ThreadRenderableItem, "type" | "event" | "data">,
): string {
  if (item.type === "delegation" && item.data?.start) {
    const task = item.data.start.data?.task ?? "";
    const end = item.data.end;
    if (end?.data?.result != null) {
      const r = end.data.result;
      const resultText = typeof r === "string" ? r : JSON.stringify(r, null, 2);
      return task ? `${task}\n\n${resultText}` : resultText;
    }
    return typeof task === "string" ? task : "";
  }

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
  return message.content.some(
    (event: any) =>
      (event.type === "ui" &&
        event.data?.placement !== "sidebar" &&
        event.data?.placement !== "attention") ||
      TEXT_EVENT_TYPES.has(event.type) ||
      DELEGATION_EVENT_TYPES.has(event.type),
  );
}

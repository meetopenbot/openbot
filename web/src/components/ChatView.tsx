import { useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { useConfig } from "../hooks/use-config";
import { WidgetRenderer } from "./WidgetRenderer";
import type { MessageReactionSentiment } from "../hooks/use-chat";
import { AgentAvatar } from "./AgentAvatar";
import { useAgentAvatarDisplay } from "../hooks/use-agent-avatar-display";
import {
  ChatMessageItem,
  hasRenderableContent,
  TEXT_EVENT_TYPES,
  type ChatRenderableItem,
} from "./chat-message";

function StreamingIndicator({ agentId }: { agentId?: string }) {
  const avatar = useAgentAvatarDisplay(agentId, false);

  return (
    <div className="flex flex-col w-full px-6 py-3 mt-1 animate-fade-in">
      <div className="flex w-full items-start gap-4">
        <div className="w-[32px] shrink-0">
          <AgentAvatar
            name={avatar.name}
            label={avatar.label}
            imageUrl={avatar.imageUrl}
            className="size-8 rounded-md shadow-sm"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-semibold text-foreground/90">
              {avatar.label}
            </span>
            <span className="text-[11px] text-muted-foreground/30 font-medium italic">
              thinking...
            </span>
          </div>

          <div className="flex items-center gap-1.5 py-1">
            <span className="size-1 rounded-full bg-foreground/40 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
            <span className="size-1 rounded-full bg-foreground/40 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
            <span className="size-1 rounded-full bg-foreground/40 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DelegationBlock({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="ml-10 my-1 border-l-2 border-muted/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        {expanded ? "Hide sub-agent details" : "Show sub-agent details"}
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}

export function ChatView({
  messages,
  streaming,
  activeAgentId,
  placeholder,
  placeholderNode,
  messageReactions = {},
  onMessageReaction,
}: {
  messages: any[];
  streaming?: boolean;
  activeAgentId?: string | null;
  placeholder?: ReactNode;
  placeholderNode?: any;
  messageReactions?: Record<string, MessageReactionSentiment>;
  onMessageReaction?: (
    messageId: string,
    reaction: MessageReactionSentiment | "none",
  ) => void | Promise<void>;
}) {
  const { data: config } = useConfig();
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleMessages = messages
    .filter((m) => m.role !== "system")
    .filter(hasRenderableContent);

  const renderableEvents = useMemo(() => {
    const events: ChatRenderableItem[] = [];

    visibleMessages.forEach((msg, msgIndex) => {
      const topLevelEvents: any[] = [];

        const content = Array.isArray(msg.content)
          ? msg.content
          : [
              {
                type: msg.role === "user" ? "user:input" : "agent:output",
                data: { content: msg.content },
                meta: { timestamp: (msg as any).timestamp || Date.now() },
              },
            ];

        content.forEach((event: any, eventIndex: number) => {
          if (event.type === "agent:output-delta") {
            const hasFinalOutput = content.some(
              (e: any) => e.type === "agent:output",
            );
            if (hasFinalOutput) return;
            const nextDelta = content
              .slice(eventIndex + 1)
              .find((e: any) => e.type === "agent:output-delta");
            if (nextDelta) return;
          }

          if (event.type === "ui" || TEXT_EVENT_TYPES.has(event.type)) {
            if (
              event.type === "ui" &&
              (event.data?.placement === "sidebar" ||
                event.data?.placement === "attention")
            )
              return;

            if (TEXT_EVENT_TYPES.has(event.type)) {
              const rawContent =
                event.data?.content ??
                event.data?.result ??
                event.data?.message;
              const delta = event.data?.delta;
              if (
                !rawContent &&
                !delta &&
                event.type !== "user:input"
              )
                return;
              if (
                typeof rawContent === "string" &&
                !rawContent.trim() &&
                !delta &&
                event.type !== "user:input"
              )
                return;
            }

            topLevelEvents.push(event);
          }
        });

      topLevelEvents.forEach((item, idx) => {
        const eventTimestamp =
          item.meta?.timestamp || (msg as any).timestamp || Date.now();
        const agentId =
          msg.role === "user"
            ? "You"
            : item.meta?.agentId || config?.name || "Assistant";

        const isDelegated = !!item.meta?.delegationId;

        events.push({
          key: `${msgIndex}-${item.type}-${idx}`,
          event: item,
          messageId: msg.id,
          meta: {
            timestamp: eventTimestamp,
            agentId,
            role: msg.role,
          },
          isGrouped: false,
          depth: isDelegated ? 1 : 0,
        });
      });
    });

    return events.map((item, index) => {
      const prev = events[index - 1];
      let isGrouped = false;
      if (
        prev &&
        prev.meta.role === item.meta.role &&
        prev.meta.agentId === item.meta.agentId &&
        prev.depth === item.depth
      ) {
        const timeDiff = item.meta.timestamp - prev.meta.timestamp;
        if (timeDiff < 5 * 60 * 1000) {
          isGrouped = true;
        }
      }
      return { ...item, isGrouped };
    });
  }, [visibleMessages, config?.name]);

  // Must run unconditionally (before any early return) — Rules of Hooks.
  const segments = useMemo(() => {
    const result: Array<
      | { kind: "item"; item: ChatRenderableItem }
      | { kind: "delegation"; items: ChatRenderableItem[] }
    > = [];

    let currentNested: ChatRenderableItem[] | null = null;

    for (const item of renderableEvents) {
      if (item.depth && item.depth > 0) {
        if (!currentNested) currentNested = [];
        currentNested.push(item);
      } else {
        if (currentNested) {
          result.push({ kind: "delegation", items: currentNested });
          currentNested = null;
        }
        result.push({ kind: "item", item });
      }
    }
    if (currentNested) {
      result.push({ kind: "delegation", items: currentNested });
    }

    return result;
  }, [renderableEvents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [renderableEvents, streaming]);

  if (renderableEvents.length === 0) {
    return (
      <div className="flex flex-col justify-end items-start h-full min-h-[400px] w-full px-5 pb-1 pt-8">
        {placeholder}
        {!placeholder && placeholderNode && (
          <WidgetRenderer block={placeholderNode} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full py-4">
      {segments.map((seg, segIdx) => {
        if (seg.kind === "item") {
          return (
            <ChatMessageItem
              key={seg.item.key}
              item={seg.item}
              messageReactions={messageReactions}
              onMessageReaction={onMessageReaction}
            />
          );
        }
        return (
          <DelegationBlock key={`delegation-${segIdx}`}>
            {seg.items.map((item) => (
              <ChatMessageItem
                key={item.key}
                item={item}
                messageReactions={messageReactions}
                onMessageReaction={onMessageReaction}
              />
            ))}
          </DelegationBlock>
        );
      })}
      {streaming && <StreamingIndicator agentId={activeAgentId ?? undefined} />}
      <div ref={bottomRef} className="h-0" />
    </div>
  );
}

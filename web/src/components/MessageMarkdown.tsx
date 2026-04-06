import React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** Compact prose tuned for Slack-like chat: headings ≈ body size, bold labels not document titles. */
const chatProseClass =
  "prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed text-foreground/90 " +
  "prose-p:my-1 " +
  /* Headings: same ballpark as message text, minimal hierarchy jump (Slack-style sections) */
  "prose-h1:text-[14px] prose-h1:font-bold prose-h1:leading-snug prose-h1:text-foreground prose-h1:mt-3 prose-h1:mb-1 " +
  "prose-h2:text-[13px] prose-h2:font-bold prose-h2:leading-snug prose-h2:text-foreground prose-h2:mt-2.5 prose-h2:mb-1 " +
  "prose-h3:text-[13px] prose-h3:font-semibold prose-h3:leading-snug prose-h3:text-foreground prose-h3:mt-2 prose-h3:mb-0.5 " +
  "prose-h4:text-[13px] prose-h4:font-semibold prose-h4:leading-snug prose-h4:text-foreground prose-h4:mt-2 prose-h4:mb-0.5 " +
  "prose-h5:text-[13px] prose-h5:font-medium prose-h5:leading-snug prose-h5:text-foreground prose-h5:mt-1.5 prose-h5:mb-0.5 " +
  "prose-h6:text-[12px] prose-h6:font-medium prose-h6:leading-snug prose-h6:text-muted-foreground prose-h6:mt-1.5 prose-h6:mb-0.5 prose-h6:uppercase prose-h6:tracking-wide " +
  "prose-a:text-primary prose-a:no-underline " +
  "prose-code:text-[12px] prose-code:font-mono prose-code:font-normal prose-code:text-foreground/95 " +
  "prose-code:bg-muted/55 prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/40 prose-pre:text-[12px] prose-pre:my-2 prose-pre:leading-relaxed " +
  "prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-blockquote:my-2 " +
  "prose-hr:border-border prose-hr:my-3 " +
  "prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1 " +
  /* Inline-ish images: cap size so chat doesn’t get huge embeds */
  "prose-img:my-2 prose-img:block prose-img:rounded-md prose-img:border prose-img:border-border/20 " +
  "prose-img:max-h-44 prose-img:max-w-[min(100%,18rem)] prose-img:w-auto prose-img:h-auto prose-img:object-contain " +
  /* Drop extra top gap when a message starts with a heading */
  "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_h4:first-child]:mt-0";

function MentionText({ children: text }: { children: string }) {
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
    staleTime: 60_000,
  });

  if (!text || agents.length === 0) return <>{text}</>;

  const mentionPattern = /@(\w+)/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text)) !== null) {
    const id = match[1];
    const agent = agents.find(
      (a) => a.id.toLowerCase() === id.toLowerCase() || a.name.toLowerCase() === id.toLowerCase(),
    );
    if (agent) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(
        <button
          key={`${match.index}-${id}`}
          type="button"
          onClick={() => {
            const dmId = `dm_${agent.id}`;
            const params = new URLSearchParams(window.location.search);
            params.set("conversationId", dmId);
            params.set("tab", "chat");
            window.history.pushState({}, "", `?${params.toString()}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="inline-flex items-center gap-0.5 rounded px-1 py-px text-primary font-semibold bg-primary/8 hover:bg-primary/15 transition-colors cursor-pointer"
        >
          @{agent.name}
        </button>,
      );
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex === 0) return <>{text}</>;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

export function MessageMarkdown({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  if (!children) return null;

  return (
    <div className={cn(chatProseClass, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children: linkChildren, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {linkChildren}
            </a>
          ),
          p: ({ children: pChildren }) => (
            <p>
              {Array.isArray(pChildren)
                ? pChildren.map((child, i) =>
                    typeof child === "string" ? <MentionText key={i}>{child}</MentionText> : child,
                  )
                : typeof pChildren === "string"
                  ? <MentionText>{pChildren}</MentionText>
                  : pChildren}
            </p>
          ),
          img: ({ src, alt, ...props }) => (
            <img
              src={src}
              alt={alt ?? ""}
              loading="lazy"
              decoding="async"
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

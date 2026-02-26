import { useMelony } from "@melony/react";
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../hooks/use-session";
import { api, type AttachmentRef } from "../lib/api";
import { AgentAvatar } from "./AgentAvatar";

const BUILT_IN_AGENTS = [
  { name: "os", description: "Handles shell commands and file system operations" },
  { name: "topic", description: "Automatically titles threads" },
  { name: "agent-creator", description: "Helps create new custom agents" },
];

export function Composer() {
  const { send, streaming, stop, events } = useMelony();
  const { sessionId } = useSession();
  const [content, setContent] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [showActionPopover, setShowActionPopover] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionPopoverRef = useRef<HTMLDivElement>(null);
  const [popoverIndex, setPopoverIndex] = useState(0);

  const { data: customAgents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const isTypingAgent = content.startsWith("@") && !content.includes(" ");
  const agentQuery = isTypingAgent ? content.slice(1).toLowerCase() : "";

  const allAgents = [...BUILT_IN_AGENTS, ...customAgents];
  const filteredAgents = allAgents.filter(a => a.name.toLowerCase().includes(agentQuery));
  const showAgentPopover = isTypingAgent && filteredAgents.length > 0;

  useEffect(() => {
    if (showAgentPopover) {
      setPopoverIndex(0);
    }
  }, [agentQuery, showAgentPopover]);

  const clearPendingImages = () => {
    setPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = reader.result;
        if (typeof value !== "string") {
          reject(new Error("Failed to read image"));
          return;
        }
        const marker = "base64,";
        const markerIndex = value.indexOf(marker);
        resolve(markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value);
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
      reader.readAsDataURL(file);
    });

  const uploadPendingImages = async (): Promise<AttachmentRef[]> => {
    const uploads: AttachmentRef[] = [];
    for (const image of pendingImages) {
      const dataBase64 = await readFileAsBase64(image.file);
      const uploaded = await api.uploadImage({
        name: image.file.name,
        mimeType: image.file.type,
        dataBase64,
      });
      uploads.push(uploaded);
    }
    return uploads;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!content.trim() && pendingImages.length === 0) || streaming || uploadingImages) return;

    const trimmed = content.trim();
    const finalContent = selectedAgent
      ? trimmed ? `@${selectedAgent} ${trimmed}` : `@${selectedAgent}`
      : trimmed;

    let attachments: AttachmentRef[] = [];

    if (pendingImages.length > 0) {
      try {
        setUploadingImages(true);
        attachments = await uploadPendingImages();
      } catch (error) {
        console.error("Image upload failed:", error);
        setUploadingImages(false);
        return;
      } finally {
        setUploadingImages(false);
      }
    }

    send(attachments.length > 0
      ? {
        type: "user:multimodal",
        data: { content: finalContent, attachments },
      }
      : {
        type: "user:text",
        data: { content: finalContent },
      });
    setContent("");
    clearPendingImages();
    // Do NOT reset selectedAgent here, so it sticks between messages!
  };

  const handleStop = () => {
    stop();
  };

  const handleSelectAgent = (agentName: string) => {
    setSelectedAgent(agentName);
    setContent("");
    textareaRef.current?.focus();
  };

  const handleRemoveAgent = () => {
    setSelectedAgent(null);
  };

  const handleAttachImageClick = () => {
    setShowActionPopover(false);
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const newItems = imageFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...newItems]);
    e.target.value = "";
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAgentPopover) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopoverIndex((prev) => Math.min(prev + 1, filteredAgents.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopoverIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredAgents[popoverIndex]) {
          handleSelectAgent(filteredAgents[popoverIndex].name);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    if (e.key === "Backspace" && content === "" && selectedAgent) {
      handleRemoveAgent();
    }
  };

  useEffect(() => {
    setContent("");
    setSelectedAgent(null);
    clearPendingImages();

    // Check for pre-filled message in URL
    const params = new URLSearchParams(window.location.search);
    const msg = params.get("msg");
    if (msg) {
      if ((msg.startsWith("/") || msg.startsWith("@")) && msg.includes(" ")) {
        const firstSpace = msg.indexOf(" ");
        const prefix = msg.slice(1, firstSpace);
        const rest = msg.slice(firstSpace + 1).trim();

        // Trust the prefix from the URL
        setSelectedAgent(prefix);
        setContent(rest);
      } else {
        setContent(msg);
      }

      // Clean up the URL
      const newUrl = window.location.pathname + "?tab=" + (params.get("tab") || "chat");
      window.history.replaceState({}, "", newUrl);
    }
  }, [sessionId]);

  useEffect(() => () => clearPendingImages(), []);

  useEffect(() => {
    const handleSetText = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const msg = customEvent.detail;
      if (msg) {
        if ((msg.startsWith("/") || msg.startsWith("@")) && msg.includes(" ")) {
          const firstSpace = msg.indexOf(" ");
          const prefix = msg.slice(1, firstSpace);
          const rest = msg.slice(firstSpace + 1).trim();

          setSelectedAgent(prefix);
          setContent(rest);
        } else {
          setContent(msg);
        }
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };

    window.addEventListener('set-composer-text', handleSetText);
    return () => window.removeEventListener('set-composer-text', handleSetText);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      if (content === "") {
        textareaRef.current.style.height = "44px";
      } else {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    }
  }, [content]);

  useEffect(() => {
    if (!streaming) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [streaming, sessionId]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!actionPopoverRef.current) return;
      if (actionPopoverRef.current.contains(event.target as Node)) return;
      setShowActionPopover(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowActionPopover(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const canSend = (Boolean(content.trim()) || pendingImages.length > 0) && !streaming && !uploadingImages;

  const usageEvent = useMemo(() => {
    const eventsList = (events ?? []) as any[];
    for (let i = eventsList.length - 1; i >= 0; i -= 1) {
      const event = eventsList[i];
      if (event?.type === "usage:update" && event?.data?.scope === "manager") return event;
    }
    for (let i = eventsList.length - 1; i >= 0; i -= 1) {
      const event = eventsList[i];
      if (event?.type === "usage:update") return event;
    }
    return null;
  }, [events]);

  const executionEvent = useMemo(() => {
    const eventsList = (events ?? []) as any[];
    for (let i = eventsList.length - 1; i >= 0; i -= 1) {
      const event = eventsList[i];
      if (event?.type === "execution:state") return event;
    }
    return null;
  }, [events]);

  const usageData = usageEvent?.data;
  const executionData = executionEvent?.data as
    | {
      traceId?: string;
      state?: string;
      currentStepId?: string;
      error?: string;
    }
    | undefined;
  const usageModel = usageData?.model as string | undefined;
  const turnInputTokens = Number(usageData?.turn?.inputTokens ?? 0);
  const turnOutputTokens = Number(usageData?.turn?.outputTokens ?? 0);
  const sessionTotalTokens = Number(usageData?.session?.totalTokens ?? 0);

  const formatInt = (value: number) => new Intl.NumberFormat().format(Math.max(0, Math.floor(value)));

  return (
    <div className="relative w-full rounded-2xl border border-border/60 bg-background shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-200 focus-within:border-border focus-within:shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
      {showAgentPopover && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 w-[300px] overflow-hidden rounded-xl border border-border/60 bg-background p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground/70">
            Select an Agent
          </div>
          <div className="flex max-h-[240px] flex-col overflow-y-auto">
            {filteredAgents.map((agent, i) => (
              <button
                key={agent.name}
                type="button"
                onMouseEnter={() => setPopoverIndex(i)}
                onClick={() => handleSelectAgent(agent.name)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${i === popoverIndex ? "bg-muted/60" : "hover:bg-muted/40"
                  }`}
              >
                <AgentAvatar name={agent.name} className="w-8 h-8 rounded-lg" />
                <div className="flex flex-col items-start gap-0.5">
                  <div className="text-[13px] font-medium text-foreground">@{agent.name}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground/70">
                    {agent.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col">
        {selectedAgent && (
          <div className="flex items-center px-3 pt-2.5 pb-2">
            <div className="flex items-center gap-1.5 rounded-md bg-foreground/10 px-2 py-1 text-[11px] font-medium text-foreground">
              <AgentAvatar name={selectedAgent} className="w-3.5 h-3.5 rounded-sm" />
              <span>@{selectedAgent}</span>
              <button
                type="button"
                onClick={handleRemoveAgent}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/20 hover:text-foreground"
                aria-label="Remove agent"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="px-3 pt-2">
            <div className="flex flex-wrap gap-2">
              {pendingImages.map((image) => (
                <div key={image.id} className="relative">
                  <img
                    src={image.previewUrl}
                    alt={image.file.name}
                    className="h-14 w-14 rounded-lg border border-border/60 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingImage(image.id)}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border/70 bg-background p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${image.file.name}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedAgent ? `Message @${selectedAgent}...` : "Message OpenBot..."}
          className={`min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-4 ${selectedAgent ? 'pt-1 pb-3' : 'py-3'} text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none`}
          rows={1}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div ref={actionPopoverRef} className="relative flex items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowActionPopover((prev) => !prev)}
              className="rounded-md p-1.5 text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
              aria-label="Open actions"
              title="Open actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
            {showActionPopover && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-44 overflow-hidden rounded-xl border border-border/60 bg-background p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2">
                <button
                  type="button"
                  onClick={handleAttachImageClick}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted/50"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  <span>Upload image</span>
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {executionData?.state && (
                <div className="group relative">
                  <div className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/80 transition-colors group-hover:bg-muted/60 group-hover:text-foreground">
                    {executionData.state}
                    {executionData.currentStepId ? ` · ${executionData.currentStepId}` : ""}
                  </div>
                  <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-[220px] -translate-x-1/2 rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[11px] shadow-xl group-hover:block">
                    <div className="text-muted-foreground">
                      Trace: <span className="text-foreground/90">{executionData.traceId ?? "-"}</span>
                    </div>
                    {executionData.error && (
                      <div className="mt-1 text-red-500/90">
                        {executionData.error}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {usageData && (
                <div className="group relative">
                  <div
                    className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/80 transition-colors group-hover:bg-muted/60 group-hover:text-foreground"
                    aria-label="Token usage"
                  >
                    {formatInt(turnInputTokens)} in / {formatInt(sessionTotalTokens)} total
                  </div>
                  <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-[160px] -translate-x-1/2 rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[11px] shadow-xl group-hover:block">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Last prompt</span>
                      <span className="font-medium text-foreground">{formatInt(turnInputTokens)}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Output: {formatInt(turnOutputTokens)} tokens
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Session total: {formatInt(sessionTotalTokens)} tokens
                    </div>
                    {usageModel && (
                      <div className="mt-1 truncate text-muted-foreground/80">
                        {usageModel}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-lg bg-foreground p-1.5 text-background transition-all duration-150 hover:opacity-80"
                aria-label="Stop generation"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className={`rounded-lg p-1.5 transition-all duration-150 ${canSend
                  ? "bg-foreground text-background hover:opacity-80"
                  : "cursor-not-allowed text-muted-foreground/30"
                  }`}
                aria-label={uploadingImages ? "Uploading images" : "Send message"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

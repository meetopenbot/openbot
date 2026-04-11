import { useChat } from "../hooks/use-chat";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSession } from "../hooks/use-session";
import { useQuery } from "@tanstack/react-query";
import { api, type AttachmentRef } from "../lib/api";
import { cn } from "../lib/utils";
import { AgentMentionDropdown } from "./composer/AgentMentionDropdown";
import { ImagePreview } from "./composer/ImagePreview";
import { ActionPopover } from "./composer/ActionPopover";
import { UsageStats } from "./composer/UsageStats";

export function Composer() {
  const { send, streaming, stop, events } = useChat();
  const { conversationId } = useSession();
  const [content, setContent] = useState("");
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [showActionPopover, setShowActionPopover] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDm = conversationId.startsWith("dm_");
  const targetAgentId = isDm ? conversationId.slice(3) : undefined;

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const filteredAgents = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return agents.filter(
      (a) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [mentionQuery, agents]);

  const detectMention = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([a-z0-9-_]*)$/i);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const insertMention = useCallback((agentId: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const before = content.slice(0, cursorPos);
    const after = content.slice(cursorPos);
    const match = before.match(/@([a-z0-9-_]*)$/i);
    if (!match) return;
    const start = before.length - match[0].length;
    const newContent = before.slice(0, start) + `@${agentId} ` + after;
    setContent(newContent);
    setMentionQuery(null);
    setTimeout(() => {
      const newPos = start + agentId.length + 2;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }, [content]);

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

    send({
      type: "user:input",
      meta: {
        ...(targetAgentId ? { agentId: targetAgentId } : {}),
      },
      data: { content: trimmed, attachments: attachments.length > 0 ? attachments : undefined },
    });
    setContent("");
    clearPendingImages();
  };

  const handleStop = () => {
    stop();
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
    if (mentionQuery !== null && filteredAgents.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredAgents.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredAgents[mentionIndex].id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    setContent("");
    clearPendingImages();

    const params = new URLSearchParams(window.location.search);
    const msg = params.get("msg");
    if (msg) {
      setContent(msg);
      const newUrl = window.location.pathname + "?tab=" + (params.get("tab") || "chat");
      window.history.replaceState({}, "", newUrl);
    }
  }, [conversationId]);

  useEffect(() => () => clearPendingImages(), []);

  useEffect(() => {
    const handleSetText = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const msg = customEvent.detail;
      if (msg) {
        setContent(msg);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };

    window.addEventListener('set-composer-text', handleSetText);
    return () => window.removeEventListener('set-composer-text', handleSetText);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      if (content === "") {
        textareaRef.current.style.height = "22px";
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
  }, [streaming, conversationId]);

  const canSend = (Boolean(content.trim()) || pendingImages.length > 0) && !streaming && !uploadingImages;

  return (
    <div className="relative w-full rounded-xl border border-border/40 bg-background/50 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,0,0,0.02)] transition-all duration-200 focus-within:border-border/80 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <form onSubmit={handleSubmit} className="flex flex-col">
        <ImagePreview pendingImages={pendingImages} onRemove={removePendingImage} />

        <AgentMentionDropdown
          filteredAgents={filteredAgents}
          mentionIndex={mentionIndex}
          onSelect={insertMention}
        />

        <div className="flex items-start px-4 py-3.5">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              detectMention(e.target.value, e.target.selectionStart ?? 0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isDm && targetAgentId ? `Message ${targetAgentId}...` : "Message channel..."
            }
            className="flex-1 min-h-[22px] max-h-[200px] w-full resize-none bg-transparent p-0 text-[13px] leading-relaxed placeholder:text-muted-foreground/30 focus:outline-none"
            rows={1}
          />
        </div>
        
        <div className="flex items-center justify-between px-3 pb-2 rounded-b-xl">
          <div className="relative flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />
            <ActionPopover
              showActionPopover={showActionPopover}
              setShowActionPopover={setShowActionPopover}
              onAttachImage={handleAttachImageClick}
            />
          </div>

          <div className="flex items-center gap-2.5">
            <UsageStats events={events} />

            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-md bg-foreground p-1.5 text-background transition-all duration-150 hover:opacity-90 active:scale-95"
                aria-label="Stop generation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className={cn(
                  "rounded-md p-1.5 transition-all duration-150 active:scale-95",
                  canSend
                    ? "bg-foreground text-background hover:opacity-90"
                    : "cursor-not-allowed text-muted-foreground/20"
                )}
                aria-label={uploadingImages ? "Uploading images" : "Send message"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

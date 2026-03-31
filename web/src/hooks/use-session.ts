import { useState, useEffect, useMemo, useCallback } from "react";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeConversationId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("channel_")) return trimmed;
  const slug = slugify(trimmed.slice("channel_".length));
  return slug ? `channel_${slug}` : trimmed;
}

export function useSession() {
  const [path, setPath] = useState(window.location.search);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.search);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const conversationId = useMemo(() => {
    const params = new URLSearchParams(path);
    return normalizeConversationId(params.get("conversationId") || "");
  }, [path]);

  const navigate = useCallback((newPath: string) => {
    window.history.pushState({}, "", newPath);
    window.dispatchEvent(new Event("popstate"));
  }, []);

  const ensureConversationInUrl = useCallback((nextConversationId?: string) => {
    const params = new URLSearchParams(window.location.search);
    const conversationIdToSet = normalizeConversationId(nextConversationId ?? conversationId);
    if (!params.has("conversationId") && conversationIdToSet) {
      params.set("conversationId", conversationIdToSet);
      const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
      window.history.replaceState({}, "", newUrl);
      setPath(window.location.search);
    }
  }, [conversationId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawConversationId = params.get("conversationId");
    if (!rawConversationId) return;
    const normalizedConversationId = normalizeConversationId(rawConversationId);
    if (normalizedConversationId === rawConversationId) return;
    params.set("conversationId", normalizedConversationId);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
    setPath(window.location.search);
  }, [path]);

  return { conversationId, path, navigate, ensureConversationInUrl };
}

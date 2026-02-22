import { useState, useEffect, useMemo, useCallback } from "react";
import { generateId } from "melony/client";

export function useSession() {
  const [path, setPath] = useState(window.location.search);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.search);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const sessionId = useMemo(() => {
    const params = new URLSearchParams(path);
    return params.get("sessionId") || `ses_${generateId()}`;
  }, [path]);

  const navigate = useCallback((newPath: string) => {
    window.history.pushState({}, "", newPath);
    window.dispatchEvent(new Event("popstate"));
  }, []);

  const ensureSessionInUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("sessionId")) {
      params.set("sessionId", sessionId);
      const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
      window.history.replaceState({}, "", newUrl);
      setPath(window.location.search);
    }
  }, [sessionId]);

  return { sessionId, path, navigate, ensureSessionInUrl };
}

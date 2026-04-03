import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * Maps stream meta (`agentName` is often an agent id) to props for `AgentAvatar`.
 */
export function useAgentAvatarDisplay(raw: string | undefined, isUser: boolean) {
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (isUser) {
      return { name: "user", label: "You", imageUrl: undefined as string | undefined };
    }
    const key = (raw && raw.trim()) || "default";
    const byId = agents.find((a) => a.id === key);
    if (byId) {
      return {
        name: byId.isDefault ? "default" : byId.id,
        label: byId.name,
        imageUrl: byId.image,
      };
    }
    const byName = agents.find((a) => a.name === key);
    if (byName) {
      return {
        name: byName.isDefault ? "default" : byName.id,
        label: byName.name,
        imageUrl: byName.image,
      };
    }
    if (key === "default") {
      return { name: "default" as const, label: "OpenBot", imageUrl: undefined as string | undefined };
    }
    return { name: key, label: key, imageUrl: undefined as string | undefined };
  }, [isUser, raw, agents]);
}

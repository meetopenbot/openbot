import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: api.getConversations,
    meta: { tags: ["conversations"] },
    refetchInterval: 30_000,
  });
}

export function useChannels() {
  return useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    meta: { tags: ["channels"] },
    refetchInterval: 30_000,
  });
}

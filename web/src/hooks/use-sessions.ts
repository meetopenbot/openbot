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

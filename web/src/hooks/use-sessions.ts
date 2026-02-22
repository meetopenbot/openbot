import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: api.getSessions,
    meta: { tags: ["sessions"] },
    refetchInterval: 30_000,
  });
}

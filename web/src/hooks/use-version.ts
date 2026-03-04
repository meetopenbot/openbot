import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useVersion() {
  return useQuery({
    queryKey: ["version-status"],
    queryFn: api.getVersion,
    refetchInterval: 1000 * 60 * 60, // Check every hour
  });
}

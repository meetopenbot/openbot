import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: api.getModels,
    staleTime: 5 * 60 * 1000,
  });
}

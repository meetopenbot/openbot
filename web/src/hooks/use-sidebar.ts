import { createContext, useContext } from "react";

export interface SidebarContextValue {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  open: true,
  toggle: () => {},
  setOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

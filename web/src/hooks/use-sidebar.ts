import { createContext, useContext } from "react";

export interface SidebarContextValue {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  rightPanel: 'spec' | 'agent' | null;
  setRightPanel: (panel: 'spec' | 'agent' | null) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  open: true,
  toggle: () => {},
  setOpen: () => {},
  rightPanel: null,
  setRightPanel: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

import { createContext, useContext } from "react";

export interface SidebarContextValue {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  rightOpen: boolean;
  toggleRight: () => void;
  setRightOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  open: true,
  toggle: () => {},
  setOpen: () => {},
  rightOpen: false,
  toggleRight: () => {},
  setRightOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

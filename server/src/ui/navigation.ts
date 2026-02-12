import { ui } from "@melony/ui-kit";

const listItemProps = (path: string) => ({
  onClickAction: {
    type: "client:navigate",
    data: { path },
  },
});

export const navigationUI = ui.box({ width: "full" }, [ui.list({
  gap: "none",
}, [
  ui.listItem(listItemProps("/"), [
    ui.icon("PlusIcon", { size: "sm" }),
    ui.text("New chat", { size: "sm" })
  ])
])]);

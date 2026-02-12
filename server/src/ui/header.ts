import { ui } from "@melony/ui-kit";

export const headerUI = (tab: string) =>
  ui.box(
    {
      padding: "sm",
      background: "background",
      width: "full",
    },
    [
      ui.row({ justify: "between", align: "center", width: "full" }, [
        ui.row({ gap: "xs", align: "center" }, [
          ui.listItem({
            onClickAction: {
              type: "client:navigate",
              data: { path: "/" }
            }
          },
            [ui.text("OpenBot")]
          ),
          ui.divider({ orientation: "vertical", margin: "xs" }),
          ui.button({
            label: "Chat",
            variant: (tab === "chat" || !tab) ? "secondary" : "ghost",
            size: "sm",
            onClickAction: {
              type: "client:navigate",
              data: { path: "/" },
            },
          }),
          ui.button({
            label: "Skills",
            variant: tab === "skills" ? "secondary" : "ghost",
            size: "sm",
            onClickAction: {
              type: "client:navigate",
              data: { path: "/?tab=skills" },
            },
          }),
          ui.button({
            label: "Settings",
            variant: tab === "settings" ? "secondary" : "ghost",
            size: "sm",
            onClickAction: {
              type: "client:navigate",
              data: { path: "/?tab=settings" },
            },
          }),
        ]),
        ui.row({ gap: "sm", align: "center", width: "auto" }, [
          ui.button({
            label: "JD",
            variant: "outline",
            size: "sm",
          }),
        ]),
      ]),
    ]
  );
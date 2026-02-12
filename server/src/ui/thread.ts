import { ui } from "@melony/ui-kit";

export const threadUI = ui.box({
  width: "full",
  height: "full",
}, [ui.thread({
  placeholder: "Ask me anything about your system or projects...",
}, [
  ui.heading("Hey there!"),
  ui.text("I'm your trusty system sidekick with superpowers over your files and terminal. Let's make some magic happen!", { size: "sm", color: "mutedForeground" }),
  ui.col({ gap: "sm" }, [
    ui.button({ onClickAction: { type: "user:text", data: { content: "What is in my current directory?" } }, label: "What is in my current directory?", size: "sm", variant: "outline" }),
    ui.button({ onClickAction: { type: "user:text", data: { content: "Check system status" } }, label: "Check system status", size: "sm", variant: "outline" }),
    ui.button({ onClickAction: { type: "user:text", data: { content: "Who am I?" } }, label: "Who am I?", size: "sm", variant: "outline" }),
    ui.button({ onClickAction: { type: "user:text", data: { content: "Who are you?" } }, label: "Who are you?", size: "sm", variant: "outline" }),
  ]),
])]);

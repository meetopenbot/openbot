import { ui } from "@melony/ui-kit";

export const settingsUI = ui.box({
  width: "full",
  height: "full",
  padding: "xl",
  background: "background",
}, [
  ui.col({ gap: "xl", width: "full" }, [
    ui.col({ gap: "xs" }, [
      ui.heading("Settings", 2),
      ui.text("Manage your OpenBot configuration", { color: "mutedForeground" }),
    ]),

    ui.divider(),

    ui.col({ gap: "md" }, [
      ui.heading("Model Configuration", 4),
      ui.row({ align: "center", gap: "md" }, [
        ui.box({ flex: 1 }, [
          ui.node("label", { value: "Provider" }),
          ui.text("OpenAI (GPT-4o)", { size: "sm", color: "mutedForeground" }),
        ]),
        ui.button({ label: "Change", variant: "outline", size: "sm" })
      ]),
    ]),

    ui.col({ gap: "md" }, [
      ui.heading("API Keys", 4),
      ui.col({ gap: "sm" }, [
        ui.node("label", { value: "OpenAI API Key" }),
        ui.row({ gap: "sm" }, [
          ui.input("openai_api_key", undefined, {
            placeholder: "sk-...",
            inputType: "password",
            defaultValue: "••••••••••••••••",
            width: "full"
          }),
          ui.button({ label: "Save", size: "sm" })
        ])
      ])
    ]),

    ui.col({ gap: "md" }, [
      ui.heading("Theme", 4),
      ui.themeToggle(),
    ])
  ])
]);

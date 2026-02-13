import { ui } from "@melony/ui-kit";
import { loadConfig } from "../config.js";

export const settingsUI = async () => {
  const config = loadConfig();
  const hasOpenAIKey = !!config.openaiApiKey;
  const hasAnthropicKey = !!config.anthropicApiKey;

  return ui.form({
    onSubmitAction: {
      type: "action:updateSettings",
      data: {}
    }
  }, [
    ui.box({
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
          ui.col({ gap: "sm" }, [
            ui.input("model", undefined, {
              placeholder: "e.g. gpt-4o-mini",
              width: "full",
              defaultValue: config.model || "gpt-4o-mini"
            }),
          ]),
        ]),

        ui.col({ gap: "md" }, [
          ui.heading("API Keys", 4),
          ui.col({ gap: "lg" }, [
            // OpenAI Key
            ui.col({ gap: "sm" }, [
              ui.node("label", { value: "OpenAI API Key" }),
              ui.input("openai_api_key", undefined, {
                placeholder: "sk-...",
                inputType: "password",
                defaultValue: hasOpenAIKey ? "••••••••••••••••" : "",
                width: "full"
              }),
            ]),

            // Anthropic Key
            ui.col({ gap: "sm" }, [
              ui.node("label", { value: "Anthropic API Key" }),
              ui.input("anthropic_api_key", undefined, {
                placeholder: "sk-ant-...",
                inputType: "password",
                defaultValue: hasAnthropicKey ? "••••••••••••••••" : "",
                width: "full"
              }),
            ])
          ])
        ]),

        ui.col({ gap: "md" }, [
          ui.heading("Theme", 4),
          ui.themeToggle(),
        ]),

        ui.divider(),

        ui.row({ justify: "end" }, [
          ui.button({
            label: "Save Settings",
            type: "submit",
            variant: "primary"
          })
        ])
      ])
    ])
  ]);
};

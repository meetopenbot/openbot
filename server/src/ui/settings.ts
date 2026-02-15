import { ui } from "@melony/ui-kit";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "../config.js";
import { listYamlAgents } from "../registry/index.js";
import path from "node:path";

export const settingsUI = async () => {
  const config = loadConfig();
  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  const agentsDir = path.join(resolvedBaseDir, "agents");

  const hasOpenAIKey = !!config.openaiApiKey;
  const hasAnthropicKey = !!config.anthropicApiKey;

  const agents = await listYamlAgents(agentsDir);

  return ui.box({
    width: "full",
    height: "full",
    overflow: "auto",
  }, [
    ui.col({ padding: "xl", gap: "xl", width: "full", flex: 1 }, [
      ui.col({ gap: "xs" }, [
        ui.heading("Settings", 2),
        ui.text("Manage your OpenBot configuration", { color: "mutedForeground" }),
      ]),

      ui.divider(),

      ui.form({
        onSubmitAction: {
          type: "action:updateSettings",
          data: {}
        }
      }, [
        ui.col({ gap: "xl" }, [
          ui.col({ gap: "md" }, [
            ui.heading("Model Configuration", 4),
            ui.col({ gap: "sm" }, [
              ui.input("model", undefined, {
                placeholder: "provider/model (e.g. openai/gpt-4o)",
                width: "full",
                defaultValue: config.model || "openai/gpt-4o-mini"
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

          ui.row({ justify: "end" }, [
            ui.button({
              label: "Save Settings",
              type: "submit",
              variant: "primary"
            })
          ])
        ])
      ]),

      ui.divider(),

      ui.col({ gap: "md" }, [
        ui.heading("Installed Agents", 4),
        ui.text("Agents installed in ~/.openbot/agents", { color: "mutedForeground", size: "sm" }),
        ui.col({ gap: "sm" }, agents.map(agent => (
          ui.box({
            padding: "md",
            background: "muted",
          }, [
            ui.row({ justify: "between", align: "center" }, [
              ui.col({ gap: "xs" }, [
                ui.text(agent.name, { weight: "bold" }),
                ui.text(agent.description, { size: "sm", color: "mutedForeground" }),
              ]),
              ui.button({
                label: "Open Folder",
                variant: "secondary",
                size: "sm",
                onClickAction: {
                  type: "action:openAgentFolder",
                  data: { folder: agent.folder }
                }
              })
            ])
          ])
        )))
      ])
    ]),
  ]);
};

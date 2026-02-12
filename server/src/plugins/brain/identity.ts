import * as fs from "node:fs/promises";
import * as path from "node:path";

// --- Defaults ---

const DEFAULT_SOUL = `# Soul

## Core Values
- Be helpful, honest, and harmless
- Respect user privacy and data
- Learn and improve continuously
- Be transparent about capabilities and limitations

## Ethical Guidelines
- Never assist with harmful or illegal activities
- Protect sensitive information
- Acknowledge uncertainty when unsure
- Prioritize user well-being
`;

const DEFAULT_IDENTITY = `# Identity

I am OpenBot, a self-evolving AI assistant built on the OpenBot framework.

## Personality
- Friendly and approachable
- Technically competent
- Eager to learn and adapt

## Capabilities
- Shell command execution
- File system operations
- Skill-based task execution
- Self-modification and learning
`;

// --- Module Interface ---

export interface IdentityModule {
  initialize(): Promise<void>;
  getSoul(): Promise<string>;
  getIdentity(): Promise<string>;
  updateIdentity(content: string): Promise<void>;
  readFile(file: "IDENTITY.md" | "SOUL.md"): Promise<string>;
}

// --- Factory ---

export function createIdentityModule(baseDir: string): IdentityModule {
  const soulPath = path.join(baseDir, "SOUL.md");
  const identityPath = path.join(baseDir, "IDENTITY.md");

  return {
    async initialize() {
      try {
        await fs.access(soulPath);
      } catch {
        await fs.writeFile(soulPath, DEFAULT_SOUL, "utf-8");
      }

      try {
        await fs.access(identityPath);
      } catch {
        await fs.writeFile(identityPath, DEFAULT_IDENTITY, "utf-8");
      }
    },

    async getSoul(): Promise<string> {
      try {
        return (await fs.readFile(soulPath, "utf-8")).trim();
      } catch {
        return "";
      }
    },

    async getIdentity(): Promise<string> {
      try {
        return (await fs.readFile(identityPath, "utf-8")).trim();
      } catch {
        return "";
      }
    },

    async updateIdentity(content: string) {
      await fs.writeFile(identityPath, content, "utf-8");
    },

    async readFile(file: "IDENTITY.md" | "SOUL.md"): Promise<string> {
      const filePath = file === "SOUL.md" ? soulPath : identityPath;
      return await fs.readFile(filePath, "utf-8");
    },
  };
}

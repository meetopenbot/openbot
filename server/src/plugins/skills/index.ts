import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import { SkillMeta } from "./types.js";
import { statusWidget } from "../../ui/widgets/status.js";
import { resourceCardWidget } from "../../ui/widgets/resource-card.js";

// Re-exports
export { skillsToolDefinitions } from "./types.js";
export type { SkillMeta } from "./types.js";

// --- Options ---

export interface SkillsStatusEvent extends Event {
  type: "skills:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export interface SkillsLoadedEvent extends Event {
  type: "skills:loaded";
  data: { skillId: string; title: string; instructions: string };
}

export interface SkillsPluginOptions {
  baseDir: string; // resolved path to the bot home (e.g., ~/.openbot)
}

// --- Helpers ---

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(process.env.HOME || "", p.slice(2));
  }
  return p;
}

// --- Skills Module (internal) ---

function createSkillsModule(skillsDir: string) {
  async function list(): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];

    try {
      const folders = await fs.readdir(skillsDir);

      for (const folder of folders) {
        if (folder.startsWith("_") || folder.startsWith(".")) continue;

        const skillPath = path.join(skillsDir, folder, "SKILL.md");
        try {
          const content = await fs.readFile(skillPath, "utf-8");
          const { data } = matter(content);
          skills.push({
            id: folder,
            title: data.title || folder,
            description: data.description || "No description",
            version: data.version,
            tools: data.tools,
            triggers: data.triggers,
          });
        } catch {
          // Invalid skill, skip
        }
      }
    } catch {
      // Skills directory doesn't exist yet
    }

    return skills;
  }

  return {
    async initialize() {
      await fs.mkdir(skillsDir, { recursive: true });
    },

    list,

    async load(
      skillId: string
    ): Promise<{ meta: Record<string, any>; instructions: string }> {
      const skillPath = path.join(skillsDir, skillId, "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");
      const { data, content: body } = matter(content);
      return { meta: data, instructions: body.trim() };
    },

    async create(
      id: string,
      title: string,
      description: string,
      content: string
    ): Promise<string> {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
        throw new Error("Skill id must be kebab-case (e.g., 'my-skill')");
      }

      const skillDir = path.join(skillsDir, id);
      await fs.mkdir(skillDir, { recursive: true });

      const skillContent = `---
title: ${title}
description: ${description}
version: 1.0.0
createdAt: ${new Date().toISOString()}
---

${content}`;

      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        skillContent,
        "utf-8"
      );

      return `skills/${id}/SKILL.md`;
    },

    async update(
      id: string,
      content: string,
      title?: string,
      description?: string
    ): Promise<string> {
      const skillPath = path.join(skillsDir, id, "SKILL.md");
      const existingContent = await fs.readFile(skillPath, "utf-8");
      const { data: existingData } = matter(existingContent);

      const newTitle = title || existingData.title || id;
      const newDescription =
        description || existingData.description || "No description";

      // Bump patch version
      let version = existingData.version || "1.0.0";
      const parts = version.split(".");
      if (parts.length === 3) {
        parts[2] = (parseInt(parts[2]) + 1).toString();
        version = parts.join(".");
      }

      const skillContent = `---
title: ${newTitle}
description: ${newDescription}
version: ${version}
updatedAt: ${new Date().toISOString()}
createdAt: ${existingData.createdAt || new Date().toISOString()}
---

${content}`;

      await fs.writeFile(skillPath, skillContent, "utf-8");
      return version;
    },

    async getIndex(): Promise<string> {
      const skills = await list();

      if (skills.length > 0) {
        return `## Available Skills

You have the following skills available. Use \`loadSkill\` with the skill id to get full instructions before executing.

${skills.map((s) => `- **${s.title}** (\`${s.id}\`): ${s.description}`).join("\n")}`;
      }

      return `## Skills

You have no skills yet. When you learn reusable patterns, create skills using \`createSkill\` so you can use them again later.`;
    },
  };
}

// --- Prompt Builder ---

/**
 * Create a prompt builder that generates the skills section
 * of the system prompt. Use alongside the memory prompt builder.
 */
export function createSkillsPromptBuilder(baseDir: string) {
  const expandedBase = expandPath(baseDir);
  const skills = createSkillsModule(path.join(expandedBase, "skills"));

  return async () => skills.getIndex();
}

// --- Plugin ---

/**
 * Skills Plugin for Melony
 *
 * Manages reusable skill definitions: load, create, update, list.
 * Fully independent from the memory plugin.
 */
export const skillsPlugin = (
  options: SkillsPluginOptions
): MelonyPlugin<any, any> => (builder) => {
  const expandedBase = expandPath(options.baseDir);
  const skills = createSkillsModule(path.join(expandedBase, "skills"));

  // ─── Initialization ───────────────────────────────────────────────

  builder.on("init", async function* () {
    await skills.initialize();

    yield {
      type: "skills:status",
      data: { message: "Skills initialized", severity: "success" },
    };
  });

  // ─── Load ─────────────────────────────────────────────────────────

  builder.on("action:loadSkill", async function* (event) {
    const { skillId, toolCallId } = event.data;

    try {
      const { meta, instructions } = await skills.load(skillId);

      yield {
        type: "skills:loaded",
        data: {
          skillId,
          title: meta.title || skillId,
          instructions: meta.description || "No description",
        },
      };

      yield {
        type: "action:result",
        data: {
          action: "loadSkill",
          toolCallId,
          result: { id: skillId, meta, instructions },
        },
      };
    } catch {
      yield {
        type: "action:result",
        data: {
          action: "loadSkill",
          toolCallId,
          result: { error: `Skill "${skillId}" not found` },
        },
      };
    }
  });

  // ─── List ─────────────────────────────────────────────────────────

  builder.on("action:listSkills", async function* (event) {
    const { toolCallId } = event.data;
    const skillsList = await skills.list();

    yield {
      type: "action:result",
      data: {
        action: "listSkills",
        toolCallId,
        result: { skills: skillsList },
      },
    };
  });

  // ─── Create ───────────────────────────────────────────────────────

  builder.on("action:createSkill", async function* (event) {
    const { id, title, description, content, toolCallId } = event.data;

    try {
      const skillPath = await skills.create(id, title, description, content);

      yield {
        type: "skills:status",
        data: { message: `Skill "${title}" created`, severity: "success" },
      };

      yield {
        type: "action:result",
        data: {
          action: "createSkill",
          toolCallId,
          result: {
            success: true,
            path: skillPath,
            message: `Skill "${title}" created successfully`,
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "skills:status",
        data: {
          message: `Failed to create skill: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:result",
        data: {
          action: "createSkill",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Update ───────────────────────────────────────────────────────

  builder.on("action:updateSkill", async function* (event) {
    const { id, title, description, content, toolCallId } = event.data;

    try {
      const version = await skills.update(id, content, title, description);

      yield {
        type: "skills:status",
        data: {
          message: `Skill updated to v${version}`,
          severity: "success",
        },
      };

      yield {
        type: "action:result",
        data: {
          action: "updateSkill",
          toolCallId,
          result: {
            success: true,
            path: `skills/${id}/SKILL.md`,
            version,
            message: `Skill updated to version ${version}`,
          },
        },
      };
    } catch (error: any) {
      const errorMsg =
        (error as any).code === "ENOENT"
          ? `Skill "${id}" does not exist`
          : error.message;

      yield {
        type: "skills:status",
        data: {
          message: `Failed to update skill: ${errorMsg}`,
          severity: "error",
        },
      };
      yield {
        type: "action:result",
        data: {
          action: "updateSkill",
          toolCallId,
          result: { error: errorMsg },
        },
      };
    }
  });

  builder.on(
    "skills:status" as any,
    async function* (event: SkillsStatusEvent) {
      yield ui.event(statusWidget(event.data.message, event.data.severity));
    }
  );

  builder.on(
    "skills:loaded" as any,
    async function* (event: SkillsLoadedEvent) {
      yield ui.event(
        resourceCardWidget(event.data.title, "", [
          ui.text(event.data.instructions),
        ])
      );
    }
  );
};

export default skillsPlugin;

import { z } from "zod";

// --- Skill Metadata ---

export interface SkillMeta {
  id: string;
  title: string;
  description: string;
  version?: string;
  tools?: string[];
  triggers?: string[];
}

// --- Tool Definitions ---

export const skillsToolDefinitions = {
  loadSkill: {
    description:
      "Load a skill's full instructions when you need to use it. Call this before executing a skill.",
    inputSchema: z.object({
      skillId: z
        .string()
        .describe("The skill folder name (e.g., 'code-review')"),
    }),
  },
  createSkill: {
    description:
      "Create a new skill from learned knowledge. Use when you discover a reusable pattern.",
    inputSchema: z.object({
      id: z
        .string()
        .describe("Skill folder name in kebab-case (e.g., 'web-search')"),
      title: z.string().describe("Human-readable skill title"),
      description: z
        .string()
        .describe("Brief description of what the skill does"),
      content: z
        .string()
        .describe("Full skill instructions in markdown"),
    }),
  },
  updateSkill: {
    description:
      "Update an existing skill with new knowledge or improvements.",
    inputSchema: z.object({
      id: z
        .string()
        .describe("The skill folder name (e.g., 'code-review')"),
      title: z
        .string()
        .optional()
        .describe("New title for the skill"),
      description: z
        .string()
        .optional()
        .describe("New description for the skill"),
      content: z
        .string()
        .describe("Updated full skill instructions in markdown"),
    }),
  },
  listSkills: {
    description: "List all available skills with their metadata.",
    inputSchema: z.object({}),
  },
};

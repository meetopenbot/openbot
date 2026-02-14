import { z } from "zod";

// --- Plugin Options ---

export interface BrainPluginOptions {
  baseDir: string;
  allowSoulModification?: boolean; // default: false (safety)
}

// --- Memory ---

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface MemoryIndex {
  entries: MemoryEntry[];
}

// --- Tool Definitions ---

export const brainToolDefinitions = {
  // Memory tools
  remember: {
    description:
      "Store something important in long-term memory. Use for user preferences, learned facts, project context, etc.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("The information to remember"),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Tags for categorization (e.g., 'user-preference', 'project', 'learning')"
        ),
    }),
  },
  recall: {
    description:
      "Search your memory for relevant information. Use before answering questions that might relate to past interactions.",
    inputSchema: z.object({
      query: z.string().describe("What to search for in memory"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by specific tags"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default: 5)"),
    }),
  },
  forget: {
    description: "Remove a specific memory entry by ID.",
    inputSchema: z.object({
      memoryId: z
        .string()
        .describe("The ID of the memory entry to remove"),
    }),
  },
  journal: {
    description:
      "Add a journal entry for today. Use for session notes, learnings, and reflections.",
    inputSchema: z.object({
      content: z.string().describe("Journal entry content"),
    }),
  },

  // Identity tools
  updateIdentity: {
    description:
      "Update your identity file to refine your personality and traits. Start it with # Identity.",
    inputSchema: z.object({
      content: z.string().describe("New content for IDENTITY.md"),
    }),
  },
  readIdentity: {
    description: "Read your current identity or soul configuration.",
    inputSchema: z.object({
      file: z
        .enum(["IDENTITY.md", "SOUL.md"])
        .describe("Which identity file to read"),
    }),
  },
};

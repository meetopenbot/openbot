import type { ConversationEvent, RunJob } from '../app/types.js';

export interface ServerContext {
  runtime: any;
  resolvedBaseDir: string;
  scheduleReload: () => void;
  activeRuns: Set<string>;
  runConversationById: Map<string, string>;
  runAgentsById: Map<string, Set<string>>;
  cancelledRuns: Set<string>;
  runQueue: RunJob[];
  processRunQueue: () => Promise<void>;
  appendConversationEvent: (
    conversationId: string,
    runId: string,
    event: ConversationEvent,
  ) => Promise<void>;
  subscribeConversation: (
    conversationId: string,
    listener: (event: ConversationEvent) => void,
  ) => () => void;
  options: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
  };
}

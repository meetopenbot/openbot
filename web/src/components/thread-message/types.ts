export type ThreadRenderableItem = {
  key: string;
  event?: any;
  messageId: string;
  meta: {
    timestamp: number;
    agentName: string;
    role: string;
  };
  isGrouped: boolean;
  /** When false, hide "N replies" on this row (same messageId can have multiple event rows). */
  showReplySummary?: boolean;
};

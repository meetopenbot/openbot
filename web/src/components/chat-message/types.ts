export type ChatRenderableItem = {
  key: string;
  event?: any;
  messageId: string;
  meta: {
    timestamp: number;
    agentId: string;
    role: string;
  };
  isGrouped: boolean;
  depth?: number;
};

export type ChatRenderableItem = {
  key: string;
  event?: any;
  messageId: string;
  meta: {
    timestamp: number;
    agentName: string;
    role: string;
  };
  isGrouped: boolean;
  depth?: number;
};

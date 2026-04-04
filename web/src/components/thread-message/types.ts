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
};

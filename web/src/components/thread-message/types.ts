export type ThreadRenderableItem = {
  key: string;
  type: "delegation" | "standard";
  data?: { start?: any; end?: any; subs: any[] };
  event?: any;
  messageId: string;
  meta: {
    timestamp: number;
    agentName: string;
    role: string;
  };
  isGrouped: boolean;
};

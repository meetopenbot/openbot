import { block, UIBlock } from "./block.js";

export const resourceCardWidget = (title: string, subtitle?: string, children: UIBlock[] = []) =>
  block('resource-card', { title, subtitle, children });

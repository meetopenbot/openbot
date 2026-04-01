import { block } from "./block.js";

export const keyValue = (title: string, data: Record<string, any>) =>
  block('key-value', { title, data });

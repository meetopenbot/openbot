import { block } from '../block.js';

export const emptyState = (message: string, iconName?: string) =>
  block('empty-state', { message, iconName });

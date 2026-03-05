import { block } from '../block.js';

export const actionList = (title: string, actions: Array<{ label: string, action: any, variant?: string }>) =>
  block('action-list', { title, actions });

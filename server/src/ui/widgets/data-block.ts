import { block } from '../block.js';

export const dataBlockWidget = (data: Record<string, any>) =>
  block('data-block', { data });

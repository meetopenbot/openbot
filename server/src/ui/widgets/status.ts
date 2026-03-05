import { block } from '../block.js';

export const statusWidget = (message: string, severity: 'info' | 'success' | 'error' = 'info') =>
  block('status', { message, severity });

import { block, UIBlockOptions } from '../block.js';

export const statusWidget = (message: string, severity: 'info' | 'success' | 'error' = 'info', options: UIBlockOptions = {}) =>
  block('status', { message, severity }, options);

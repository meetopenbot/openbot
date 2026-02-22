import { ui } from '@melony/ui-kit';

export const statusWidget = (message: string, severity: 'info' | 'success' | 'error' = 'info') =>
  ui.text(message, {
    color: severity === 'error' ? 'danger' : severity === 'success' ? 'success' : 'muted',
    size: 'xs',
  });

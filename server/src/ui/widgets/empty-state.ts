import { ui } from '@melony/ui-kit/server';

export const emptyState = (message: string, iconName?: string) =>
  ui.box({ padding: 'lg', border: true, radius: 'md' }, [
    ui.col({ align: 'center', justify: 'center', gap: 'sm' }, [
      iconName ? ui.icon(iconName) : ui.text('∅', { size: 'lg', color: 'muted' }),
      ui.text(message, { size: 'sm', color: 'muted' })
    ])
  ]);

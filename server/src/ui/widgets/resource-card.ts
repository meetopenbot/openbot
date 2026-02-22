import { ui, UINode } from '@melony/ui-kit';

export const resourceCardWidget = (title: string, subtitle?: string, children: UINode[] = []) =>
  ui.box({
    border: true,
    radius: 'lg',
    padding: 'md',
  }, [
    ui.heading(title, { level: 4 }),
    ui.text(subtitle ?? '', { size: 'sm', color: 'mutedForeground' }),
    ...children,
  ]);

import { ui } from '@melony/ui-kit/server';

export const keyValue = (title: string, data: Record<string, any>) =>
  ui.box({ border: true, radius: 'md', padding: 'md' }, [
    ui.col({ gap: 'md' }, [
      ui.heading(title, { level: 4 }),
      ui.col(
        { gap: 'xs' },
        Object.entries(data)
          .filter(([_, v]) => v !== undefined && v !== null)
          .map(([key, value]) =>
            ui.row({ gap: 'sm', align: 'start' }, [
              ui.text(`${key}:`, { weight: 'bold', size: 'sm', color: 'muted' }),
              ui.text(String(value), { size: 'sm' })
            ])
          )
      )
    ])
  ]);

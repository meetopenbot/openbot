import { ui } from '@melony/ui-kit/server';

export const actionList = (title: string, actions: Array<{ label: string, action: any, variant?: string }>) =>
  ui.box({ border: true, radius: 'md', padding: 'md' }, [
    ui.col({ gap: 'md' }, [
      ui.heading(title, { level: 4 }),
      ui.row({ gap: 'sm', wrap: 'wrap' }, 
        actions.map(a => 
          ui.button({ variant: (a.variant as any) || 'outline', onClickAction: a.action }, [
            ui.text(a.label, { size: 'sm' })
          ])
        )
      )
    ])
  ]);

import { ui } from '@melony/ui-kit/server';

export const approvalCard = (title: string, description: string, approveAction: any, denyAction: any) =>
  ui.box({ border: true, radius: 'md', padding: 'md' }, [
    ui.col({ gap: 'sm' }, [
      ui.heading(title, { level: 4 }),
      ui.text(description, { size: 'sm', color: 'muted' }),
      ui.row({ gap: 'sm', justify: 'end' }, [
        ui.button({ variant: 'outline', onClickAction: denyAction }, [
          ui.text('Deny', { size: 'xs' })
        ]),
        ui.button({ variant: 'primary', onClickAction: approveAction }, [
          ui.text('Approve', { size: 'xs' })
        ])
      ])
    ])
  ]);

import { ui } from '@melony/ui-kit/server';

export interface ApprovalCardDetail {
  label: string;
  value: string;
}

export interface ApprovalCardData {
  summary: string;
  details?: ApprovalCardDetail[];
  rawPayload?: string;
}

export const approvalCard = (title: string, data: ApprovalCardData, approveAction: any, denyAction: any) =>
  ui.box({ border: true, radius: 'md', padding: 'md' }, [
    ui.col({ gap: 'sm' }, [
      ui.heading(title, { level: 4 }),
      ui.text(data.summary, { size: 'sm', color: 'muted' }),
      ...(data.details?.length
        ? [
            ui.box({ border: true, radius: 'sm', padding: 'sm' }, [
              ui.col(
                { gap: 'xs' },
                data.details.map((detail) =>
                  ui.row({ gap: 'sm', align: 'start' }, [
                    ui.text(`${detail.label}:`, { size: 'xs', color: 'muted', weight: 'semibold' }),
                    ui.text(detail.value, { size: 'xs' }),
                  ])
                )
              ),
            ]),
          ]
        : []),
      ...(data.rawPayload
        ? [
            ui.box({ border: true, radius: 'sm', padding: 'sm' }, [
              ui.col({ gap: 'xs' }, [
                ui.text('Full action payload', { size: 'xs', color: 'muted', weight: 'semibold' }),
                ui.text(data.rawPayload, { size: 'xs' }),
              ]),
            ]),
          ]
        : []),
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

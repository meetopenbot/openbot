import { ui } from "@melony/ui-kit"


export const dataBlockWidget = (data: Record<string, any>) =>
  ui.col({ gap: 'xs' }, Object.entries(data).filter(([_, v]) => v !== undefined && v !== null).map(([key, value]) =>
    ui.row({ gap: 'sm', align: 'start' }, [
      ui.text(`${key}:`, { weight: 'semibold', size: 'xs', color: 'muted' }),
      ui.text(String(value), { size: 'xs' }),
    ])
  ));
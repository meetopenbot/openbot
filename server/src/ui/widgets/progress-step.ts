import { ui } from '@melony/ui-kit/server';

export const progressStep = (currentStep: number, totalSteps: number, label: string) =>
  ui.row({ gap: 'md', align: 'center', padding: 'sm' }, [
    ui.text(`Step ${currentStep} of ${totalSteps}`, { weight: 'bold', size: 'sm' }),
    ui.text(label, { size: 'sm', color: 'muted' })
  ]);

import { block } from "./block.js";

export const progressStep = (currentStep: number, totalSteps: number, label: string) =>
  block('progress-step', { currentStep, totalSteps, label });

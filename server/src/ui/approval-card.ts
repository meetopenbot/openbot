import { block, UIBlockOptions } from "./block.js";

export interface ApprovalCardDetail {
  label: string;
  value: string;
}

export interface ApprovalCardData {
  summary: string;
  details?: ApprovalCardDetail[];
  rawPayload?: string;
}

export const approvalCard = (title: string, data: ApprovalCardData, approveAction: any, denyAction: any, options: UIBlockOptions = {}) =>
  block('approval-card', {
    title,
    summary: data.summary,
    details: data.details,
    rawPayload: data.rawPayload,
    approveAction,
    denyAction
  }, options);

import { block, UIBlockOptions } from "./block.js";

export interface InquiryOption {
  label: string;
  id: string;
  variant?: 'primary' | 'secondary';
  action?: any;
}

export interface InquiryData {
  question: string;
  description?: string;
  options?: InquiryOption[];
}

export const inquiryCard = (title: string, data: InquiryData, options: UIBlockOptions = {}) =>
  block('inquiry-card', {
    title,
    question: data.question,
    description: data.description,
    options: data.options || [],
  }, options);

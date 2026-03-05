import { block } from '../block.js';

export const codeSnippet = (code: string, language: string = 'text') =>
  block('code-snippet', { code, language });

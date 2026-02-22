import { ui } from '@melony/ui-kit/server';

export const codeSnippet = (code: string, language: string = 'text') =>
  ui.markdown(`\`\`\`${language}\n${code}\n\`\`\``);

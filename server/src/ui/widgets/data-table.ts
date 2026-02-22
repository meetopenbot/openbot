import { ui } from '@melony/ui-kit/server';

export const dataTable = (headers: string[], rows: any[][]) => {
  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  const markdownTable = `${headerRow}\n${separator}\n${dataRows}`;

  return ui.markdown(markdownTable);
};

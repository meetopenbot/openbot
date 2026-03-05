import { block } from '../block.js';

export const dataTable = (headers: string[], rows: any[][]) =>
  block('data-table', { headers, rows });

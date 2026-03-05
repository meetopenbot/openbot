import { block, UIBlockOptions } from '../block.js';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export const todoList = (todos: TodoItem[], options: UIBlockOptions = {}) =>
  block('todo-list', { todos }, options);

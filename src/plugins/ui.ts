import { MelonyPlugin } from 'melony';
import {
  OpenBotEvent,
  OpenBotState,
  RenderUIWidgetData,
  UIWidgetField,
  UIWidgetListItem,
  UIWidgetSpec,
} from '../app/types.js';
import z from 'zod';

const actionSchema = z.object({
  id: z.string().describe('Stable action ID returned by client:ui:widget:response.'),
  label: z.string().describe('Human-readable button label.'),
  value: z.unknown().optional().describe('Optional machine-readable value for this action.'),
  variant: z.enum(['primary', 'secondary', 'danger']).optional(),
  disabled: z.boolean().optional(),
});

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const fieldSchema = z.object({
  id: z.string().describe('Stable field ID used as the submitted value key.'),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'date']),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
  defaultValue: z.unknown().optional(),
});

const listItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'error', 'cancelled']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const widgetBaseSchema = {
  widgetId: z.string().optional().describe('Optional stable widget ID. Defaults from toolCallId.'),
  title: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'submitted', 'cancelled', 'error']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

const renderWidgetSchema = z.union([
  z.object({
    ...widgetBaseSchema,
    kind: z.literal('message'),
    actions: z.array(actionSchema).optional(),
  }),
  z.object({
    ...widgetBaseSchema,
    kind: z.literal('choice'),
    actions: z.array(actionSchema).min(1),
  }),
  z.object({
    ...widgetBaseSchema,
    kind: z.literal('form'),
    fields: z.array(fieldSchema).optional(),
    submitLabel: z.string().optional(),
    actions: z.array(actionSchema).optional(),
    props: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Legacy form props. Prefer fields and submitLabel.'),
  }),
  z.object({
    ...widgetBaseSchema,
    kind: z.literal('list'),
    items: z.array(listItemSchema).optional(),
    actions: z.array(actionSchema).optional(),
  }),
  z.object({
    kind: z.enum(['approval', 'todo_list']).describe('Legacy preset. Prefer choice or list.'),
    widgetId: z.string().optional(),
    title: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const asFields = (value: unknown): UIWidgetField[] | undefined =>
  Array.isArray(value) ? (value as UIWidgetField[]) : undefined;

const asListItems = (value: unknown): UIWidgetListItem[] | undefined =>
  Array.isArray(value) ? (value as UIWidgetListItem[]) : undefined;

const todoToListItem = (todo: unknown, index: number): UIWidgetListItem => {
  if (!isRecord(todo)) {
    return {
      id: `todo_${index + 1}`,
      label: String(todo),
    };
  }

  return {
    id: readString(todo.id) || `todo_${index + 1}`,
    label:
      readString(todo.label) ||
      readString(todo.task) ||
      readString(todo.title) ||
      `Todo ${index + 1}`,
    description: readString(todo.description),
    status: readString(todo.status) as UIWidgetListItem['status'],
    metadata: todo,
  };
};

const createWidgetId = (data: RenderUIWidgetData, toolCallId?: string): string => {
  if ('widgetId' in data && data.widgetId) return data.widgetId;
  if (toolCallId) return `widget_${toolCallId}`;
  return `widget_${Date.now()}`;
};

const normalizeWidget = (
  data: RenderUIWidgetData,
  state: OpenBotState,
  toolCallId?: string,
): UIWidgetSpec => {
  const widgetId = createWidgetId(data, toolCallId);

  if (data.kind === 'approval') {
    const props = data.props || {};
    return {
      widgetId,
      kind: 'choice',
      title: data.title || 'Approval Required',
      body:
        readString(props.message) ||
        readString(props.summary) ||
        'Please approve or deny this action.',
      metadata: {
        ...(data.metadata || {}),
        legacyKind: 'approval',
        actionId: props.actionId,
      },
      actions: [
        { id: 'approve', label: 'Approve', value: props.actionId || 'approve', variant: 'primary' },
        { id: 'deny', label: 'Deny', value: props.actionId || 'deny', variant: 'danger' },
      ],
    };
  }

  if (data.kind === 'todo_list') {
    const props = data.props || {};
    const stateTodos = isRecord(state.threadDetails?.state)
      ? (state.threadDetails.state as Record<string, unknown>).todos
      : undefined;
    const todos = asListItems(props.todos) || asListItems(stateTodos) || [];
    return {
      widgetId,
      kind: 'list',
      title: data.title || readString(props.title) || 'Task List',
      description: readString(props.description),
      metadata: {
        ...(data.metadata || {}),
        legacyKind: 'todo_list',
      },
      items: todos.map(todoToListItem),
    };
  }

  if (data.kind === 'form') {
    const propsSource = (data as unknown as { props?: unknown }).props;
    const props = isRecord(propsSource) ? propsSource : {};
    return {
      widgetId,
      kind: 'form',
      title: data.title || 'Details Required',
      description: data.description,
      body: data.body,
      state: data.state,
      metadata: data.metadata,
      fields: data.fields || asFields(props.schema) || [],
      submitLabel: data.submitLabel || readString(props.submitLabel),
      actions: data.actions,
    };
  }

  if (data.kind === 'list') {
    return {
      ...data,
      widgetId,
      title: data.title || 'Task List',
      items: data.items || [],
    };
  }

  if (data.kind === 'choice') {
    return {
      ...data,
      widgetId,
      title: data.title || 'Choose an Option',
    };
  }

  if (data.kind === 'message') {
    return {
      ...data,
      widgetId,
      title: data.title || 'Message',
    };
  }

  throw new Error(`Unsupported UI widget kind: ${(data as { kind?: string }).kind || 'unknown'}`);
};

/**
 * UI Plugin for Melony.
 * Provides tools for agents to trigger interactive UI widgets.
 */
export const uiPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:render_ui_widget', async function* (event, context) {
    const widget = normalizeWidget(event.data, context.state, event.meta?.toolCallId);

    yield {
      type: 'client:ui:widget',
      data: widget,
      meta: event.meta,
    };
  });
};

export const uiToolDefinitions = {
  render_ui_widget: {
    description:
      'Render a small server-driven UI widget in the conversation. Prefer primitive kinds: message, choice, form, or list. Legacy presets approval and todo_list are still accepted.',
    inputSchema: renderWidgetSchema,
  },
};

export const plugin = {
  name: 'ui',
  description: 'UI Widgets plugin',
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  factory: uiPlugin,
  toolDefinitions: uiToolDefinitions,
};

import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import z from 'zod';

/**
 * UI Plugin for Melony.
 * Provides tools for agents to trigger interactive UI widgets.
 */
export const uiPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:render_ui_widget', async function* (event, context) {
    const { kind, title, props } = event.data;

    const finalProps = { ...(props as Record<string, unknown>) };

    // Auto-inject todos if it's a todo_list and they aren't provided
    if (kind === 'todo_list' && !finalProps.todos) {
      finalProps.todos = (context.state.threadDetails?.state as any)?.todos || [];
    }

    yield {
      type: 'client:ui:widget',
      data: {
        widgetId: `${kind}_${Date.now()}`,
        kind,
        title: title || (kind === 'approval' ? 'Approval Required' : kind === 'todo_list' ? 'Task List' : 'Details Required'),
        props: finalProps,
      },
      meta: event.meta,
    };
  });
};

export const uiToolDefinitions = {
  render_ui_widget: {
    description: 'Render an interactive UI widget (approval, todo_list, or form) in the conversation.',
    inputSchema: z.object({
      kind: z.enum(['approval', 'todo_list', 'form']).describe('The type of widget to render.'),
      title: z.string().optional().describe('Optional title for the widget.'),
      props: z.record(z.string(), z.unknown()).describe(
        'Properties for the widget. \n' +
        '- For "approval": { message: string, actionId: string }\n' +
        '- For "todo_list": { title?: string } (Note: current thread todos are auto-injected if not provided)\n' +
        '- For "form": { schema: Array<{ id, label, type, options?, required? }>, submitLabel?: string }'
      ),
    }),
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

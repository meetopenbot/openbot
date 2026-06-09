import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent, RenderWidgetEvent, UIWidgetResponseEvent } from '../../app/types.js';

/**
 * `ui` — provides a tool for the agent to render interactive UI widgets.
 * 
 * The model can choose which widget to render (form, choice, list, message)
 * depending on the situation.
 */

export const uiPlugin: Plugin = {
  id: 'ui',
  name: 'UI',
  description: 'Render interactive UI widgets to interact with the user.',
  toolDefinitions: {
    render_widget: {
      description: 'Render a UI widget to the user. Use "form" for data collection, "choice" for simple selection, "list" for displaying items, and "message" for simple notifications with actions. When using form widge to unquire user, do not provide complex forms with many fields, always try to make it simple to keep the experience smooth and straightforward.',
      inputSchema: z.object({
        kind: z.enum(['message', 'choice', 'form', 'list']).describe('The type of widget to render.'),
        title: z.string().describe('The title of the widget.'),
        description: z.string().optional().describe('A description or body text.'),
        fields: z.array(z.object({
          id: z.string().describe('Unique ID for the field.'),
          label: z.string().describe('Label shown to the user.'),
          type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'date']),
          description: z.string().optional(),
          placeholder: z.string().optional(),
          required: z.boolean().optional(),
          options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
          defaultValue: z.any().optional()
        })).optional().describe('Required for kind="form". List of form fields.'),
        actions: z.array(z.object({
          id: z.string(),
          label: z.string(),
          variant: z.enum(['primary', 'secondary', 'danger']).optional(),
        })).optional().describe('Buttons or actions available on the widget.'),
        items: z.array(z.object({
          id: z.string(),
          label: z.string(),
          description: z.string().optional(),
          status: z.enum(['pending', 'in_progress', 'done', 'error', 'cancelled']).optional(),
          metadata: z.record(z.string(), z.any()).optional()
        })).optional().describe('Required for kind="list". List of items to display.'),
        submitLabel: z.string().optional().describe('Label for the primary action button (e.g. "Submit", "Save").')
      })
    }
  },
  factory: () => (builder) => {
    // Handle the tool call from the agent
    builder.on('action:render_widget', async function* (event, context) {
      const widgetEvent = event as RenderWidgetEvent;
      const toolCallId = widgetEvent.meta?.toolCallId;
      const threadId = widgetEvent.meta?.threadId || context.state.threadId;

      if (!toolCallId) return;

      const widgetId = randomUUID();

      // Emit the UI widget event to the client
      yield {
        type: 'client:ui:widget',
        data: {
          ...widgetEvent.data,
          widgetId,
          metadata: {
            type: 'ui:request',
            originalEvent: widgetEvent
          }
        },
        meta: { agentId: context.state.agentId, threadId }
      } as OpenBotEvent;
    });

    // Handle the user's response from the UI widget
    builder.on('client:ui:widget:response', async function* (event, context) {
      const responseEvent = event as UIWidgetResponseEvent;
      const { widgetId, actionId, values, metadata } = responseEvent.data;
      if (metadata?.type !== 'ui:request') return;

      const originalEvent = metadata.originalEvent as RenderWidgetEvent;
      const toolCallId = originalEvent?.meta?.toolCallId;
      const threadId = originalEvent?.meta?.threadId || context.state.threadId;

      if (!toolCallId) return;

      // Yield a "submitted" widget update to the UI to collapse/disable it
      yield {
        type: 'client:ui:widget',
        data: {
          widgetId,
          title: originalEvent.data.title,
          kind: originalEvent.data.kind as any,
          state: 'submitted',
          body: "Thank you for your response. We will process it and get back to you soon.",
          display: 'collapsed',
          disabled: true,
          actions: [], // Clear actions to disable buttons in UI
        },
        meta: { agentId: context.state.agentId, threadId },
      } as OpenBotEvent;

      // Emit the tool result event so the agent runtime can resume
      yield {
        type: 'action:render_widget:result',
        data: {
          success: true,
          actionId,
          values,
          output: JSON.stringify(values)
        },
        meta: {
          agentId: context.state.agentId,
          threadId,
          toolCallId
        }
      } as any as OpenBotEvent;
    });
  },
};

export default uiPlugin;

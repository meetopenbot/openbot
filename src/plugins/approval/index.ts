import { randomUUID } from 'node:crypto';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent } from '../../app/types.js';

/**
 * `approval` — gates protected tool calls behind a UI confirmation widget.
 * 
 * This is a simplified version that intercepts specified actions (default: bash)
 * and requires user approval before they are allowed to proceed.
 */

// In-memory tracking for pending approval IDs with TTL (shared across plugin instances)
const pendingApprovals = new Map<string, number>();
const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export const approvalPlugin: Plugin = {
  id: 'approval',
  name: 'Approval',
  description: 'Gate protected tool calls behind a UI confirmation widget.',
  factory: ({ config, storage }) => (builder) => {
    // Actions that require approval. Defaults to bash.
    const actionsToApprove = (config.actions as string[]) || ['action:bash'];

    for (const action of actionsToApprove) {
      builder.intercept(action as OpenBotEvent['type'], (event, context) => {
        // If already approved in this flow, let it pass to the actual handler
        if (event.meta?.approvalStatus === 'approved') return event;

        // Otherwise, intercept and ask for approval via a UI widget
        const displayData = JSON.stringify((event as any)?.data) || '';

        const widgetId = randomUUID();
        pendingApprovals.set(widgetId, Date.now());

        return {
          type: 'client:ui:widget',
          data: {
            widgetId,
            kind: 'message',
            title: `The agent wants to perform \`${action}\``,
            body: displayData,
            metadata: {
              type: 'approval:request',
              originalEvent: event,
            },
            actions: [
              { id: 'approve', label: 'Approve', variant: 'primary' },
              { id: 'deny', label: 'Deny', variant: 'danger' },
            ],
          },
          meta: { agentId: context.state.agentId, threadId: context.state.threadId },
        } as OpenBotEvent;
      });
    }

    // Handle the user's response from the UI widget
    builder.on('client:ui:widget:response', async function* (event, context) {
      const { widgetId, actionId } = event.data;
      const metadata = event.data?.metadata;
      if (metadata?.type !== 'approval:request') return;

      // Verify the widget is still pending and hasn't expired
      if (!widgetId || !pendingApprovals.has(widgetId)) {
        console.warn(`[approval] Received response for unknown or already handled widget: ${widgetId}`);
        return;
      }

      const timestamp = pendingApprovals.get(widgetId)!;
      if (Date.now() - timestamp > TTL_MS) {
        pendingApprovals.delete(widgetId);
        console.warn(`[approval] Received response for expired widget: ${widgetId}`);
        return;
      }

      // Mark as handled
      pendingApprovals.delete(widgetId);

      const originalEvent = metadata.originalEvent as OpenBotEvent;
      const approved = actionId === 'approve';

      const displayData = JSON.stringify((event as any)?.data) || '';

      // Yield a "responded" widget update to the UI
      yield {
        type: 'client:ui:widget',
        data: {
          widgetId,
          kind: 'message',
          title: `Action ${approved ? 'Approved' : 'Denied'}`,
          body: displayData,
          state: approved ? 'submitted' : 'cancelled',
          display: 'collapsed',
          disabled: true,
          actions: [], // Clear actions to disable buttons in UI
        },
        meta: { agentId: context.state.agentId, threadId: context.state.threadId },
      } as OpenBotEvent;

      if (approved) {
        // Re-emit the original event with approved status so the actual handler can run
        yield {
          ...originalEvent,
          meta: {
            ...(originalEvent.meta || {}),
            approvalStatus: 'approved',
          },
        };
      } else {
        // Manually store the original event with denied status so it's recorded in history
        // but NOT re-emitted to the pipeline (to avoid actual execution).
        if (storage) {
          await storage.storeEvent({
            channelId: context.state.channelId,
            threadId: context.state.threadId,
            event: {
              ...originalEvent,
              meta: {
                ...(originalEvent.meta || {}),
                approvalStatus: 'denied',
              },
            },
          });
        }

        // Emit a failure result event for the denied action to clear the pending tool batch
        yield {
          type: `${originalEvent.type}:result` as OpenBotEvent['type'],
          data: {
            success: false,
            error: 'Action denied by user.',
            stderr: 'Action denied by user.',
            output: 'Action denied by user.',
          },
          meta: originalEvent.meta,
        } as OpenBotEvent;

        yield {
          type: 'agent:output',
          data: { content: `Action \`${originalEvent.type}\` was denied.` },
          meta: { agentId: context.state.agentId },
        } as OpenBotEvent;
      }
    });
  },
};

export default approvalPlugin;

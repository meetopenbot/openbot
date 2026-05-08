import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { storageService } from '../services/storage.js';
import { PluginMetadata } from './storage.js';

type ApprovalRule = {
  action: string;
  message?: string;
  detailKeys?: string[];
  hiddenKeys?: string[];
  executeEvent?: string;
  denyEvent?: string;
  denyData?: Record<string, unknown>;
};

type ApprovalPluginOptions = {
  rules?: ApprovalRule[];
};

type PendingApproval = {
  id: string;
  action: string;
  executeEvent: string;
  denyEvent: string;
  denyData: Record<string, unknown>;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
  message: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

const DEFAULT_RULES: ApprovalRule[] = [];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const getApprovalsFromState = (state: OpenBotState): Record<string, PendingApproval> => {
  const source = state.threadDetails?.state ?? state.channelDetails?.state;
  const stateRecord = asRecord(source);
  return asRecord(stateRecord.approvals) as Record<string, PendingApproval>;
};

const persistApprovals = async (
  state: OpenBotState,
  approvals: Record<string, PendingApproval>,
): Promise<void> => {
  if (state.threadId) {
    await storageService.patchThreadState({
      channelId: state.channelId,
      threadId: state.threadId,
      state: { approvals },
    });
    return;
  }

  await storageService.patchChannelState({
    channelId: state.channelId,
    state: { approvals },
  });
};

export const approvalPlugin =
  (options: ApprovalPluginOptions = {}): MelonyPlugin<OpenBotState, OpenBotEvent> =>
    (builder) => {
      const rules = options.rules && options.rules.length > 0 ? options.rules : DEFAULT_RULES;

      for (const rule of rules) {
        builder.on(rule.action as OpenBotEvent['type'], async function* (event, context) {
          const meta = asRecord(event.meta);
          if (meta.approvalStatus === 'approved') {
            return;
          }

          const eventData = asRecord((event as { data?: unknown }).data);
          const eventMeta = meta;

          const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const widgetId = `widget_${approvalId}`;
          const executeEvent = rule.executeEvent || rule.action;
          const denyEvent = rule.denyEvent || `${rule.action}:result`;
          const denyData = rule.denyData || {};
          const hiddenKeys = new Set(rule.hiddenKeys || []);
          const detailKeys = rule.detailKeys || Object.keys(eventData);
          const details = detailKeys
            .filter((key) => !hiddenKeys.has(key))
            .map((key) => `- ${key}: ${String(eventData[key] ?? '')}`)
            .join('\n');

          const pendingApprovals = getApprovalsFromState(context.state);
          pendingApprovals[approvalId] = {
            id: approvalId,
            action: rule.action,
            executeEvent,
            denyEvent,
            denyData,
            payload: eventData,
            meta: eventMeta,
            message: rule.message || `Approval required for ${rule.action}.`,
            createdAt: new Date().toISOString(),
            status: 'pending',
          };
          await persistApprovals(context.state, pendingApprovals);

          yield {
            type: 'client:ui:widget',
            data: {
              kind: 'choice',
              widgetId,
              title: 'Approval Required',
              body: `${rule.message || 'A protected action requires approval.'}${details ? `\n\n${details}` : ''}`,
              metadata: {
                type: 'approval:request',
                approvalId,
                action: rule.action,
              },
              actions: [
                { id: 'approve', label: 'Approve', variant: 'primary' },
                { id: 'deny', label: 'Deny', variant: 'danger' },
              ],
            },
            meta: {
              ...(event.meta || {}),
              agentId: context.state.agentId,
            },
          } as OpenBotEvent;

          yield {
            type: 'agent:output',
            data: {
              content: `Waiting for approval before running \`${rule.action}\`.`,
            },
            meta: {
              ...(event.meta || {}),
              agentId: context.state.agentId,
            },
          } as OpenBotEvent;

          context.suspend();
        });
      }

      builder.on('client:ui:widget:response', async function* (event, context) {
        const metadata = asRecord(event.data?.metadata);
        if (metadata.type !== 'approval:request') {
          return;
        }

        const approvalId = String(metadata.approvalId || '');
        if (!approvalId) {
          return;
        }

        const approvals = getApprovalsFromState(context.state);
        const approval = approvals[approvalId];
        if (!approval || approval.status !== 'pending') {
          yield {
            type: 'agent:output',
            data: { content: 'Approval request not found or already resolved.' },
            meta: {
              ...(event.meta || {}),
              agentId: context.state.agentId,
            },
          } as OpenBotEvent;
          return;
        }

        const approved = event.data.actionId === 'approve';
        approvals[approvalId] = {
          ...approval,
          status: approved ? 'approved' : 'denied',
        };
        await persistApprovals(context.state, approvals);

        if (approved) {
          yield {
            type: approval.executeEvent as OpenBotEvent['type'],
            data: approval.payload,
            meta: {
              ...(approval.meta || {}),
              approvalId,
              approvalStatus: 'approved',
            },
          } as OpenBotEvent;
          return;
        }

        yield {
          type: approval.denyEvent as OpenBotEvent['type'],
          data: {
            success: false,
            approved: false,
            error: 'Action denied by user approval.',
            ...approval.denyData,
          },
          meta: {
            ...(approval.meta || {}),
            approvalId,
          },
        } as OpenBotEvent;

        yield {
          type: 'agent:output',
          data: { content: 'Action denied by user approval.' },
          meta: {
            ...(event.meta || {}),
            agentId: context.state.agentId,
          },
        } as OpenBotEvent;
      });
    };

export const plugin: PluginMetadata = {
  id: 'approval',
  name: 'approval',
  description: 'Approval workflow for protected actions',
  kind: 'tool' as const,
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  factory: approvalPlugin,
};

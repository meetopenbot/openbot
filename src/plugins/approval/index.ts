import { MelonyPlugin } from 'melony';
import type { Plugin } from '../../bus/plugin.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { storageService } from '../../services/storage.js';

/**
 * `approval` — gates protected tool calls behind a UI confirmation widget.
 *
 * Configuration is read from the per-agent plugin config in AGENT.md:
 * ```yaml
 * plugins:
 *   - id: approval
 *     config:
 *       rules:
 *         - action: action:shell_exec
 *           message: The agent wants to run a terminal command.
 *           detailKeys: [command, cwd, shell, timeoutMs]
 * ```
 */

export type ApprovalRule = {
  action: string;
  message?: string;
  detailKeys?: string[];
  hiddenKeys?: string[];
  executeEvent?: string;
  denyEvent?: string;
  denyData?: Record<string, unknown>;
};

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  {
    action: 'action:shell_exec',
    denyEvent: 'action:shell_exec:result',
    message: 'The agent wants to run a terminal command.',
    detailKeys: ['command', 'cwd', 'shell', 'timeoutMs'],
    hiddenKeys: ['env'],
    denyData: {
      exitCode: null,
      stdout: '',
      stderr: 'Command execution was denied by the user.',
      timedOut: false,
    },
  },
];

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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

const buildApprovalPlugin =
  (rules: ApprovalRule[]): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    for (const rule of rules) {
      builder.on(rule.action as OpenBotEvent['type'], async function* (event, context) {
        const meta = asRecord(event.meta);
        if (meta.approvalStatus === 'approved') return;

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
            body: `${rule.message || 'A protected action requires approval.'}${
              details ? `\n\n${details}` : ''
            }`,
            metadata: { type: 'approval:request', approvalId, action: rule.action },
            actions: [
              { id: 'approve', label: 'Approve', variant: 'primary' },
              { id: 'deny', label: 'Deny', variant: 'danger' },
            ],
          },
          meta: { ...(event.meta || {}), agentId: context.state.agentId },
        } as OpenBotEvent;

        yield {
          type: 'agent:output',
          data: { content: `Waiting for approval before running \`${rule.action}\`.` },
          meta: { ...(event.meta || {}), agentId: context.state.agentId },
        } as OpenBotEvent;

        context.suspend();
      });
    }

    builder.on('client:ui:widget:response', async function* (event, context) {
      const metadata = asRecord(event.data?.metadata);
      if (metadata.type !== 'approval:request') return;

      const approvalId = String(metadata.approvalId || '');
      if (!approvalId) return;

      const approvals = getApprovalsFromState(context.state);
      const approval = approvals[approvalId];
      if (!approval || approval.status !== 'pending') {
        yield {
          type: 'agent:output',
          data: { content: 'Approval request not found or already resolved.' },
          meta: { ...(event.meta || {}), agentId: context.state.agentId },
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
        meta: { ...(approval.meta || {}), approvalId },
      } as OpenBotEvent;

      yield {
        type: 'agent:output',
        data: { content: 'Action denied by user approval.' },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      } as OpenBotEvent;
    });
  };

const readRules = (config: Record<string, unknown>): ApprovalRule[] => {
  const raw = config.rules;
  if (!Array.isArray(raw)) return DEFAULT_APPROVAL_RULES;
  return raw.filter(
    (entry): entry is ApprovalRule =>
      !!entry && typeof entry === 'object' && typeof (entry as { action?: unknown }).action === 'string',
  );
};

export const approvalPlugin: Plugin = {
  id: 'approval',
  name: 'Approval',
  description: 'Gate protected tool calls (e.g. shell_exec) behind a UI confirmation prompt.',
  factory: ({ config }) => buildApprovalPlugin(readRules(config)),
};

export default approvalPlugin;

import { MelonyPlugin, generateId } from "melony";
import { uiEvent } from "../ui/block.js";
import { widgets } from "../ui/registry.js";
import type { ApprovalCardData } from "../ui/approval-card.js";

export interface ApprovalRule {
  action: string;
  message?: string;
}

export interface ApprovalPluginOptions {
  rules: ApprovalRule[];
}

type PendingApproval = {
  originalEvent: any;
  createdAt: number;
};

function getActionName(eventType: string): string {
  return eventType.startsWith("action:")
    ? eventType.slice("action:".length)
    : eventType;
}

function buildApprovalData(event: any, rule: ApprovalRule): ApprovalCardData {
  const actionName = getActionName(String(event.type));
  const toolCallId = event?.data?.toolCallId;
  const data = event?.data ?? {};

  return {
    summary:
      rule.message ??
      "The agent requested a protected action. Approve to continue or deny to block it.",
    details: [
      { label: "Action", value: actionName },
      ...(toolCallId ? [{ label: "Tool call", value: String(toolCallId) }] : []),
    ],
    rawPayload: JSON.stringify(data, null, 2),
  };
}

/**
 * Minimal approval gate:
 * - Intercept protected action events.
 * - Suspend current request and show Approve/Deny UI.
 * - Resume only when user sends action:approve or action:deny.
 */
export const approvalPlugin = (options: ApprovalPluginOptions): MelonyPlugin<any, any> => (builder) => {
  const rules = options?.rules ?? [];

  builder.intercept(async (event, { state, suspend }) => {
    const type = String(event.type ?? "");
    const meta = (event as any).meta ?? {};

    // Never intercept internal approval events or already-approved replays.
    if (type === "action:approve" || type === "action:deny" || meta.approved === true) {
      return;
    }

    const rule = rules.find((r) => type.startsWith(r.action));
    if (!rule) return;

    const approvalId = `approve_${generateId()}`;
    state.pendingApprovals ??= {};
    (state.pendingApprovals as Record<string, PendingApproval>)[approvalId] = {
      originalEvent: event,
      createdAt: Date.now(),
    };

    suspend({
      type: "suspend",
      data: {
        reason: "approval",
        id: approvalId,
        event: uiEvent(
          widgets.approvalCard(
            "Approval Required",
            buildApprovalData(event, rule),
            { type: "action:approve", data: { id: approvalId } },
            { type: "action:deny", data: { id: approvalId } },
            { placement: "inline", id: approvalId }
          )
        ),
      },
    } as any);
  });

  builder.on("action:approve", async function* (event, { state }) {
    const id = event?.data?.id as string | undefined;
    if (!id) return;

    const pending = state.pendingApprovals?.[id] as PendingApproval | undefined;
    if (!pending) {
      return;
    }

    delete state.pendingApprovals[id];

    // Re-emit the original action with approval marker.
    yield {
      ...pending.originalEvent,
      meta: {
        ...(pending.originalEvent?.meta ?? {}),
        approved: true,
      },
    };
  });

  builder.on("action:deny", async function* (event, { state }) {
    const id = event?.data?.id as string | undefined;
    if (!id) return;

    const pending = state.pendingApprovals?.[id] as PendingApproval | undefined;
    if (!pending) {
      return;
    }

    delete state.pendingApprovals[id];
    yield uiEvent(widgets.status("Action denied", "error", { placement: "inline", id }));

    const originalEvent = pending.originalEvent;
    const toolCallId = originalEvent?.data?.toolCallId;
    if (toolCallId) {
      yield {
        type: "action:result",
        data: {
          action: getActionName(String(originalEvent.type ?? "")),
          toolCallId,
          result: { error: "Action denied by user", denied: true },
          success: false,
          halt: true,
        },
      };
    }
  });
};

export default approvalPlugin;

import { MelonyPlugin, generateId } from "melony";
import { ui } from "@melony/ui-kit/server";
import { widgets } from "../../ui/widgets/index.js";
import type { ApprovalCardData } from "../../ui/widgets/approval-card.js";

export interface ApprovalRule {
  action: string;
  message?: string;
  detailKeys?: string[];
  hiddenKeys?: string[];
}

export interface ApprovalPluginOptions {
  rules: ApprovalRule[];
}

const DEFAULT_REDACTED_KEY_PATTERNS = [
  /toolcallid/i,
  /content/i,
  /stdout/i,
  /stderr/i,
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
];

const MAX_VALUE_LENGTH = 240;
const MAX_DETAILS = 8;

function serializeValue(value: unknown): string {
  if (value === undefined || value === null) return "-";
  const serialized = typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  if (serialized.length <= MAX_VALUE_LENGTH) return serialized;
  return `${serialized.slice(0, MAX_VALUE_LENGTH - 3)}...`;
}

function buildActionLabel(eventType: string): string {
  const action = eventType.startsWith("action:") ? eventType.slice("action:".length) : eventType;
  return action.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function toTitleCaseKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function isRedactedKey(key: string, hiddenKeys: string[] = []): boolean {
  if (hiddenKeys.includes(key)) return true;
  return DEFAULT_REDACTED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizePayload(value: unknown, hiddenKeys: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, hiddenKeys));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitizedEntries = Object.entries(obj).map(([key, v]) => {
      if (isRedactedKey(key, hiddenKeys)) return [key, "[REDACTED]"];
      return [key, sanitizePayload(v, hiddenKeys)];
    });
    return Object.fromEntries(sanitizedEntries);
  }

  if (typeof value === "string" && value.length > 1000) {
    return `${value.slice(0, 997)}...`;
  }

  return value;
}

function summarizeData(data: Record<string, unknown> = {}, hiddenKeys: string[] = []): string {
  const safeData = sanitizePayload(data, hiddenKeys);
  return JSON.stringify(safeData, null, 2);
}

function isRenderableDetailValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function deriveDetailEntries(
  data: Record<string, unknown>,
  rule: ApprovalRule
): Array<{ label: string; value: string }> {
  const hiddenKeys = rule.hiddenKeys ?? [];

  if (rule.detailKeys?.length) {
    return rule.detailKeys
      .filter((key) => key in data)
      .filter((key) => !isRedactedKey(key, hiddenKeys))
      .filter((key) => isRenderableDetailValue(data[key]))
      .map((key) => ({
        label: toTitleCaseKey(key),
        value: serializeValue(data[key]),
      }))
      .slice(0, MAX_DETAILS);
  }

  return Object.entries(data)
    .filter(([key]) => !isRedactedKey(key, hiddenKeys))
    .filter(([_, value]) => isRenderableDetailValue(value))
    .slice(0, MAX_DETAILS)
    .map(([key, value]) => ({
      label: toTitleCaseKey(key),
      value: serializeValue(value),
    }));
}

function buildApprovalData(event: any, rule: ApprovalRule): ApprovalCardData {
  const eventType = event.type as string;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const details = [
    { label: "Action", value: buildActionLabel(eventType) },
    { label: "Event", value: eventType },
    ...deriveDetailEntries(data, rule),
  ];

  return {
    summary: rule.message || "The agent wants to execute an action. Review details before approving.",
    details,
    rawPayload: summarizeData(data, rule.hiddenKeys ?? []),
  };
}

/**
 * Approval Plugin for OpenBot.
 * Intercepts specific actions and requires user approval before proceeding.
 * Optimized using the new melony intercept() feature.
 */
export const approvalPlugin = (options: ApprovalPluginOptions): MelonyPlugin<any, any> => (builder) => {
  const { rules = [] } = options;

  // Register an interceptor that runs before any handlers.
  // This is the correct way to handle HITL/Approval in Melony.
  builder.intercept(async (event, { state, suspend }) => {
    // Skip if already approved or if it's an internal approval event
    // We cast event to any to access the meta property which is used for internal state tracking
    const meta = (event as any).meta;
    if (
      meta?.approved ||
      event.type === "action:approve" ||
      event.type === "action:deny" ||
      event.type === "ui" ||
      event.type.endsWith(":status")
    ) {
      return;
    }

    const rule = rules.find(r => event.type.startsWith(r.action));
    if (!rule) return;

    const approvalId = `approve_${generateId()}`;
    if (!state.pendingApprovals) {
      state.pendingApprovals = {};
    }
    state.pendingApprovals[approvalId] = event;

    // Use suspend(event) to emit the UI and halt execution of any handlers for this event.
    // This effectively "pauses" the run for user input.
    const approvalData = buildApprovalData(event, rule);
    suspend(ui.event(
      widgets.approvalCard(
        "Approval Required",
        approvalData,
        {
          type: "action:approve",
          data: { id: approvalId }
        },
        {
          type: "action:deny",
          data: { id: approvalId }
        }
      )
    ) as any);
  });

  // Handle Approval response from user
  builder.on("action:approve", async function* (event, { state }) {
    const { id } = event.data;
    const originalEvent = state.pendingApprovals?.[id];
    if (originalEvent) {
      delete state.pendingApprovals[id];

      yield ui.event(widgets.status("Action approved", "success"));

      // Re-emit the original event with approved: true.
      // The interceptor will see it, but bypass because of meta.approved.
      // Then the appropriate handlers for the event will finally run.
      yield {
        ...originalEvent,
        meta: {
          ...(originalEvent as any).meta,
          approved: true,
        },
      };
    }
  });

  // Handle Denial response from user
  builder.on("action:deny", async function* (event, { state }) {
    const { id } = event.data;
    const originalEvent = state.pendingApprovals?.[id];
    if (originalEvent) {
      delete state.pendingApprovals[id];
      yield ui.event(widgets.status("Action denied", "error"));

      // If it was a tool call (action:*), return a taskResult error so the LLM knows it failed
      if (originalEvent.data?.toolCallId) {
        yield {
          type: "action:taskResult",
          data: {
            action: originalEvent.type.replace("action:", ""),
            toolCallId: originalEvent.data.toolCallId,
            result: { error: "Action denied by user" },
            success: false,
          },
        };
      }
    }
  });
};

export default approvalPlugin;

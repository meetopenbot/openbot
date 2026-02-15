import { MelonyPlugin, generateId } from "melony";
import { ui } from "@melony/ui-kit/server";

export interface ApprovalRule {
  action: string;
  message?: string;
}

export interface ApprovalPluginOptions {
  rules: ApprovalRule[];
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
    suspend(ui.event(
      ui.card({
        title: "Approval Required",
        description: rule.message || `Approval required for: ${event.type}`,
      } as any, [
        ui.text(JSON.stringify(event.data, null, 2), { size: "xs" }),
        ui.row({ gap: "sm" }, [
          ui.button({
            label: "Approve",
            variant: "primary",
            onClickAction: {
              type: "action:approve",
              data: { id: approvalId }
            }
          }),
          ui.button({
            label: "Deny",
            variant: "outline",
            onClickAction: {
              type: "action:deny",
              data: { id: approvalId }
            }
          }),
        ]),
      ])
    ) as any);
  });

  // Handle Approval response from user
  builder.on("action:approve", async function* (event, { state }) {
    const { id } = event.data;
    const originalEvent = state.pendingApprovals?.[id];
    if (originalEvent) {
      delete state.pendingApprovals[id];

      yield ui.event(ui.status("Action approved", "success"));

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
      yield ui.event(ui.status("Action denied", "error"));

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

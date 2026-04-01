import type { AutomationRecord } from "./automations.js";

export interface AutomationWorkerOptions {
  listAutomations: () => Promise<AutomationRecord[]>;
  runAutomation: (automation: AutomationRecord, scheduledAt: Date) => Promise<void>;
  pollIntervalMs?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function parseNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function matchToken(value: number, token: string, min: number, max: number): boolean {
  const [base, stepRaw] = token.split("/");
  const step = stepRaw ? parseNumber(stepRaw) : null;
  if (stepRaw && (!step || step <= 0)) return false;

  const checkStep = (start: number): boolean => {
    if (!step) return true;
    return (value - start) % step === 0;
  };

  if (base === "*") {
    return checkStep(min);
  }

  if (base.includes("-")) {
    const [startRaw, endRaw] = base.split("-");
    const start = parseNumber(startRaw);
    const end = parseNumber(endRaw);
    if (start === null || end === null || start < min || end > max || start > end) return false;
    if (value < start || value > end) return false;
    return checkStep(start);
  }

  const exact = parseNumber(base);
  if (exact === null || exact < min || exact > max) return false;
  if (value !== exact) return false;
  return checkStep(exact);
}

function matchField(value: number, field: string, min: number, max: number): boolean {
  const tokens = field.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => matchToken(value, token, min, max));
}

export function isCronDue(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteField, hourField, domField, monthField, dowField] = fields;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  const minuteMatch = matchField(minute, minuteField, 0, 59);
  const hourMatch = matchField(hour, hourField, 0, 23);
  const monthMatch = matchField(month, monthField, 1, 12);
  const domMatch = matchField(dayOfMonth, domField, 1, 31);
  const dowMatch = matchField(dayOfWeek, dowField, 0, 7) || (dayOfWeek === 0 && matchField(7, dowField, 0, 7));

  const domWildcard = domField.trim() === "*";
  const dowWildcard = dowField.trim() === "*";

  const dayMatch =
    domWildcard && dowWildcard
      ? true
      : domWildcard
        ? dowMatch
        : dowWildcard
          ? domMatch
          : domMatch || dowMatch;

  return minuteMatch && hourMatch && monthMatch && dayMatch;
}

export function startAutomationWorker(options: AutomationWorkerOptions): () => void {
  const {
    listAutomations,
    runAutomation,
    pollIntervalMs = 60_000,
    logger = console,
  } = options;

  const inFlightByAutomation = new Set<string>();
  const seenMinuteByAutomation = new Map<string, string>();
  let polling = false;

  const tick = async () => {
    if (polling) return;
    polling = true;

    try {
      const now = new Date();
      const currentMinute = minuteKey(now);
      const automations = await listAutomations();

      for (const automation of automations) {
        if (!automation.enabled) continue;
        if (inFlightByAutomation.has(automation.id)) continue;
        if (seenMinuteByAutomation.get(automation.id) === currentMinute) continue;

        const due = isCronDue(automation.cron, now);
        if (!due) continue;

        seenMinuteByAutomation.set(automation.id, currentMinute);
        inFlightByAutomation.add(automation.id);

        void runAutomation(automation, new Date(now))
          .catch((err) => {
            logger.error(
              `[automations] Failed run for "${automation.name}" (${automation.id}):`,
              err
            );
          })
          .finally(() => {
            inFlightByAutomation.delete(automation.id);
          });
      }
    } catch (err) {
      logger.error("[automations] Worker tick failed:", err);
    } finally {
      polling = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, pollIntervalMs);

  logger.info(`[automations] Worker started (poll interval ${pollIntervalMs}ms)`);
  void tick();

  return () => {
    clearInterval(interval);
    logger.info("[automations] Worker stopped");
  };
}

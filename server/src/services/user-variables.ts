import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "../app/config.js";

export interface UserVariableStored {
  key: string;
  value: string;
  secret: boolean;
}

interface UserVariableFile {
  version: 1;
  variables: UserVariableStored[];
}

export interface UserVariablePublic {
  key: string;
  secret: boolean;
  hasValue: boolean;
  /** Only present when `secret` is false */
  value?: string;
}

/** Client sends this for a secret whose value should be kept from disk */
export const VARIABLE_VALUE_UNCHANGED = "••••••••••••••••";

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RESERVED_KEYS = new Set([
  "PATH",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
]);

let lastAppliedKeys = new Set<string>();

function getVariablesPath(): string {
  const cfg = loadConfig();
  return path.join(resolvePath(cfg.baseDir || DEFAULT_BASE_DIR), "variables.json");
}

export function validateVariableKey(key: string): string | null {
  const t = key.trim();
  if (!t) return "Key is required";
  if (!KEY_REGEX.test(t)) {
    return "Use letters, numbers, and underscores (must start with a letter or _)";
  }
  if (RESERVED_KEYS.has(t)) return "This variable name is reserved";
  return null;
}

export function loadUserVariables(): UserVariableStored[] {
  const p = getVariablesPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as UserVariableFile;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.variables)) return [];
    return raw.variables.filter(
      (v) =>
        v &&
        typeof v.key === "string" &&
        typeof v.value === "string" &&
        typeof v.secret === "boolean",
    );
  } catch {
    return [];
  }
}

export function saveUserVariables(variables: UserVariableStored[]): void {
  const p = getVariablesPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const data: UserVariableFile = { version: 1, variables };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function listUserVariablesPublic(): UserVariablePublic[] {
  return loadUserVariables().map((v) => {
    const key = v.key.trim();
    const base = { key, secret: v.secret, hasValue: v.value.length > 0 };
    if (v.secret) return base;
    return { ...base, value: v.value };
  });
}

/**
 * Applies stored variables to `process.env`. Keys removed from the file are deleted from
 * `process.env` if they were previously applied by this module.
 */
export function applyUserVariablesToProcessEnv(): void {
  const vars = loadUserVariables();
  const nextKeys = new Set<string>();

  for (const v of vars) {
    const k = v.key.trim();
    const keyError = validateVariableKey(k);
    if (keyError) continue;
    nextKeys.add(k);
  }

  for (const key of lastAppliedKeys) {
    if (!nextKeys.has(key)) {
      delete process.env[key];
    }
  }

  for (const v of vars) {
    const k = v.key.trim();
    const keyError = validateVariableKey(k);
    if (keyError) continue;
    process.env[k] = v.value;
  }

  lastAppliedKeys = nextKeys;
}

export interface IncomingVariableRow {
  key: string;
  secret: boolean;
  value?: string;
}

export function normalizeAndSaveVariables(rows: IncomingVariableRow[]): {
  ok: true;
  variables: UserVariableStored[];
} | { ok: false; error: string } {
  const trimmed = rows.map((r) => ({
    key: (r.key || "").trim(),
    secret: !!r.secret,
    value: r.value ?? "",
  }));

  const seen = new Set<string>();
  for (const r of trimmed) {
    if (!r.key) continue;
    if (seen.has(r.key)) {
      return { ok: false, error: `Duplicate key: ${r.key}` };
    }
    seen.add(r.key);
    const err = validateVariableKey(r.key);
    if (err) return { ok: false, error: `${r.key}: ${err}` };
  }

  const previousByKey = new Map(loadUserVariables().map((v) => [v.key.trim(), v]));

  const variables: UserVariableStored[] = [];
  for (const r of trimmed) {
    if (!r.key) continue;
    let value = r.value;
    if (r.secret && value === VARIABLE_VALUE_UNCHANGED) {
      const prev = previousByKey.get(r.key);
      value = prev && prev.secret ? prev.value : "";
    }
    variables.push({ key: r.key, value, secret: r.secret });
  }

  saveUserVariables(variables);
  applyUserVariablesToProcessEnv();
  return { ok: true, variables };
}

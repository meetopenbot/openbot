import { loadVariables, StoredVariable } from '../app/config.js';

/** Keys last applied from workspace `variables.json` (used to unset removed entries). */
let lastWorkspaceVariableKeys = new Set<string>();

function applyVariablesList(variables: StoredVariable[]) {
  const nextKeys = new Set(variables.map((v) => v.key));
  for (const key of lastWorkspaceVariableKeys) {
    if (!nextKeys.has(key)) {
      delete process.env[key];
    }
  }
  for (const variable of variables) {
    process.env[variable.key] = variable.value;
  }
  lastWorkspaceVariableKeys = nextKeys;
}

export const processService = {
  /**
   * Reload workspace variables from disk into `process.env`.
   * Call after server start and whenever `variables.json` changes.
   */
  syncWorkspaceVariablesToProcessEnv: () => {
    const { variables } = loadVariables();
    applyVariablesList(variables);
  },

  /** Apply a variable list directly (same unset semantics as sync). Prefer `syncWorkspaceVariablesToProcessEnv` when reading from disk. */
  applyVariablesToProcessEnv: (variables: StoredVariable[]) => {
    applyVariablesList(variables);
  },
};

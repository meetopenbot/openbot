import { StoredVariable } from '../app/config.js';

export const processService = {
  applyVariablesToProcessEnv: (variables: StoredVariable[]) => {
    for (const variable of variables) {
      process.env[variable.key] = variable.value;
    }
  },
};

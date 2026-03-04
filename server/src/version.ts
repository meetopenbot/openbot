import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

/**
 * Gets the version of the currently running OpenBot instance.
 * Works regardless of where the command is executed from.
 */
export function getCurrentVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Look for package.json by walking up from the current directory
    let currentDir = __dirname;
    for (let i = 0; i < 4; i++) {
      const pkgPath = join(currentDir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "openbot") {
          return pkg.version;
        }
      } catch {
        // Continue walking up
      }
      currentDir = dirname(currentDir);
    }
  } catch (err) {
    console.warn("Could not determine OpenBot version:", err);
  }

  // Fallback to a hardcoded version if detection fails
  return "0.2.3";
}

/**
 * Fetches the latest version from NPM registry and checks for updates.
 */
export async function getVersionStatus() {
  const current = getCurrentVersion();
  try {
    const response = await fetch("https://registry.npmjs.org/openbot/latest", {
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    if (!response.ok) {
      throw new Error(`NPM registry returned ${response.status}`);
    }
    const data = await response.json();
    const latest = data.version;

    return {
      current,
      latest,
      updateAvailable: current !== latest,
    };
  } catch (error) {
    console.error("Failed to check for updates:", error);
    return {
      current,
      latest: current,
      updateAvailable: false,
    };
  }
}

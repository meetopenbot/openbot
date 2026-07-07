/** Resolved public base URL for the local server. */
export function getPublicBaseUrl(port: number, configPublicUrl?: string): string {
  const fromConfig = configPublicUrl?.trim();
  if (fromConfig) {
    return fromConfig.replace(/\/$/, '');
  }
  const fromEnv = process.env.OPENBOT_PUBLIC_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return `http://localhost:${port}`;
}

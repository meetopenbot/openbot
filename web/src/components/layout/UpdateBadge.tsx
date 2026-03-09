import { useState } from "react";
import { useVersion } from "../../hooks/use-version";

export function UpdateBadge() {
  const { data: status } = useVersion();
  const [isOpen, setIsOpen] = useState(false);

  const installCommand =
    "curl -fsSL https://raw.githubusercontent.com/meetopenbot/openbot/main/install.sh | bash";

  if (!status?.updateAvailable) return null;

  return (
    <>
      <button
        onClick={() => {
          setIsOpen(true);
        }}
        className="group flex items-center gap-2 px-2.5 py-1 text-[11px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/15 border border-blue-500/20 rounded-full transition-all duration-200"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
        </span>
        <span>Update available</span>
        <span className="opacity-70 font-normal">v{status.latest}</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setIsOpen(false);
            }}
            aria-label="Close update dialog"
          />
          <div className="relative w-full max-w-xl rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
            <div className="text-sm font-semibold text-gray-100">
              New version {status.latest} is available
            </div>
            <p className="mt-2 text-sm text-gray-300">
              Run this command in your terminal:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-gray-700 bg-gray-950 p-3 text-xs text-gray-200 select-text">
              {installCommand}
            </pre>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(installCommand);
                  } catch {
                    // Ignore clipboard errors and leave manual copy available.
                  }
                }}
              >
                Copy command
              </button>
              <button
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                onClick={() => {
                  setIsOpen(false);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

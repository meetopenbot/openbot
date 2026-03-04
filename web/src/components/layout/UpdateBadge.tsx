import { useVersion } from "../../hooks/use-version";

export function UpdateBadge() {
  const { data: status } = useVersion();

  if (!status?.updateAvailable) return null;

  return (
    <button
      onClick={() => {
        alert(
          `New version ${status.latest} is available!\n\nRun this in your terminal:\nnpm install -g openbot@latest`
        );
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
  );
}

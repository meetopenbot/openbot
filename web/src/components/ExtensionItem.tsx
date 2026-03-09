import { AgentAvatar } from "./AgentAvatar";

const ChevronRight = ({ className }: { className?: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6" /></svg>
);

export const ExtensionItem = ({
  id,
  name,
  description,
  isInstalled,
  isDefault,
  isCodeOnly,
  image,
  onClick,
  onInstall,
  isInstalling
}: {
  id: string;
  name: string;
  description: string;
  type: "agent" | "plugin";
  isInstalled?: boolean;
  isDefault?: boolean;
  isCodeOnly?: boolean;
  image?: string;
  onClick?: () => void;
  onInstall?: () => void;
  isInstalling?: boolean;
}) => (
  <button
    onClick={onClick || onInstall}
    disabled={isInstalling || (onInstall && isInstalled)}
    className="flex items-center gap-3.5 p-3 rounded-[18px] hover:bg-white/5 transition-all group text-left border border-transparent hover:border-white/5"
  >
    <div className="relative shrink-0">
      {image ? (
        <img
          src={image}
          alt={name}
          className="w-[48px] h-[48px] rounded-[12px] shadow-sm transition-transform group-hover:scale-[1.05] object-cover"
        />
      ) : (
        <AgentAvatar
          name={isDefault ? "default" : id}
          className="w-[48px] h-[48px] rounded-[12px] shadow-sm transition-transform group-hover:scale-[1.05]"
        />
      )}
      {isDefault && (
        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        </div>
      )}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-0.5">
        <h3 className="font-semibold text-[15px] tracking-tight truncate">{name}</h3>
        {isCodeOnly && (
          <span className="px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-500 text-[8px] font-bold uppercase tracking-wider shrink-0 border border-orange-500/20">Code</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground/60 line-clamp-1 leading-snug font-medium whitespace-pre-line">
        {description || "No description provided"}
      </p>
    </div>
    {isInstalled ? (
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
    ) : (
      <div className="shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-border/40 group-hover:bg-foreground group-hover:text-background transition-colors">
          {isInstalling ? "Installing..." : "Install"}
        </span>
      </div>
    )}
  </button>
);

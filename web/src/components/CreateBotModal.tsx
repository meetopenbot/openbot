import { AgentAvatar } from "./AgentAvatar";
import { AgentEditForm } from "./AgentEditForm";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";

interface CreateBotModalProps {
  onClose: () => void;
}

export function CreateBotModal({ onClose }: CreateBotModalProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-[1000px]! h-[90vh] rounded-lg border border-border bg-background p-0 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/5">
          <div className="flex items-center gap-3">
            <AgentAvatar name="default" className="size-10 rounded-xl" />
            <div className="flex flex-col">
              <DialogTitle className="text-lg font-bold tracking-tight text-foreground leading-none">
                Create Bot
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mt-1">
                New Agent Profile
              </p>
            </div>
          </div>
          <DialogClose className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-150">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </DialogClose>
        </div>

        <div className="flex-1 overflow-hidden">
          <AgentEditForm
            mode="create"
            agentId="new-bot"
            agentName="New Bot"
            onUpdate={onClose}
            onBack={onClose}
            hideHeader={true}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

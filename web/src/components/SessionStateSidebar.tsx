import { useMelony } from "@melony/react";
import { useMemo } from "react";
import { cn } from "../lib/utils";

export function SessionStateSidebar() {
  const { messages } = useMelony();

  // Aggregate all state:update events into a single session state
  const sessionState = useMemo(() => {
    const state: Record<string, any> = {};
    
    // Scan all events in all messages
    messages.forEach(msg => {
      msg.content.forEach((event: any) => {
        if (event.type === "state:update" && event.data?.key) {
          state[event.data.key] = event.data.value;
        }
      });
    });
    
    return state;
  }, [messages]);

  const customKeys = Object.keys(sessionState);

  if (customKeys.length === 0) {
    return (
      <aside className="hidden xl:flex h-full w-[320px] shrink-0 flex-col border-l border-border/50 bg-muted/20">
        <div className="px-4 py-6 text-center">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-foreground/70">No session data</h3>
          <p className="text-xs text-muted-foreground/50 mt-1 px-4">
            Structured results from agents will appear here.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden xl:flex h-full w-[320px] shrink-0 flex-col border-l border-border/50 bg-muted/20">
      <div className="border-b border-border/50 px-4 py-3 bg-background/50 backdrop-blur-md sticky top-0 z-10">
        <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/60 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          Session State
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {customKeys.map(key => (
          <section key={key} className="animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-border/40" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-muted/40 px-2 py-0.5 rounded-md border border-border/20">
                {key}
              </span>
              <div className="h-px flex-1 bg-border/40" />
            </div>
            
            <StateItem value={sessionState[key]} />
          </section>
        ))}
      </div>
    </aside>
  );
}

function StateItem({ value }: { value: any }) {
  // Check if it's a TODO list pattern (array of objects with 'task' or 'title' and 'status')
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    const isTodoList = value.every(item => ('task' in item || 'title' in item) && 'status' in item);
    
    if (isTodoList) {
      return (
        <div className="space-y-2">
          {value.map((todo, idx) => (
            <div 
              key={todo.id || idx} 
              className={cn(
                "group relative flex items-start gap-3 p-3 rounded-xl border transition-all duration-200",
                todo.status === 'completed' || todo.status === 'done'
                  ? "bg-emerald-500/5 border-emerald-500/10 opacity-75"
                  : "bg-background/60 border-border/40 shadow-sm hover:border-border/80"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {todo.status === 'completed' || todo.status === 'done' ? (
                  <div className="size-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                ) : (
                  <div className="size-4 rounded-full border-2 border-muted-foreground/20 group-hover:border-primary/40 transition-colors" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn(
                  "text-xs font-medium leading-tight",
                  (todo.status === 'completed' || todo.status === 'done') ? "text-emerald-700/70 line-through" : "text-foreground/80"
                )}>
                  {todo.task || todo.title}
                </div>
                {todo.assignedAgent && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[9px] text-muted-foreground/60 uppercase tracking-tighter font-bold">Agent:</span>
                    <span className="text-[9px] text-primary/60 font-semibold">{todo.assignedAgent}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }

  // Fallback to JSON display for other types of data
  return (
    <pre className="text-[10px] bg-background/40 p-3 rounded-xl border border-border/20 font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

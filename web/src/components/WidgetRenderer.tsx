import { useMelony } from '@melony/react';
import { cn } from '../lib/utils';

export interface UIBlock {
  type: "ui-block";
  widget: string;
  props: Record<string, any>;
  placement: "thread" | "sidebar";
  id?: string;
}

export function WidgetRenderer({ block, eventMeta }: { block: UIBlock; eventMeta?: Record<string, any> }) {
  const { send } = useMelony();
  const { widget, props } = block;
  const sendAction = (action: any) => {
    if (!action || typeof action !== "object") return;
    send({
      ...action,
      meta: {
        ...(eventMeta ?? {}),
        ...(action.meta ?? {}),
      },
    });
  };

  switch (widget) {
    case 'status':
      return <StatusWidget message={props.message} severity={props.severity} />;
    case 'approval-card':
      return <ApprovalCardWidget {...props} onAction={sendAction} />;
    case 'text':
      return <TextWidget value={props.value} />;
    case 'resource-card':
      return <ResourceCardWidget {...props} />;
    case 'data-table':
      return <DataTableWidget {...props} />;
    case 'key-value':
      return <KeyValueWidget {...props} />;
    case 'data-block':
      return <DataBlockWidget {...props} />;
    case 'progress-step':
      return <ProgressStepWidget {...props} />;
    case 'action-list':
      return <ActionListWidget {...props} onAction={sendAction} />;
    case 'empty-state':
      return <EmptyStateWidget {...props} />;
    case 'code-snippet':
      return <CodeSnippetWidget {...props} />;
    case 'markdown':
      return <MarkdownWidget value={props.value} />;
    case 'todo-list':
      return <TodoListWidget todos={props.todos} />;
    default:
      return (
        <div className="p-3 border border-dashed rounded-lg text-xs text-muted-foreground bg-muted/5">
          Unknown widget: {widget}
          <pre className="mt-2 text-[10px] overflow-auto">
            {JSON.stringify(props, null, 2)}
          </pre>
        </div>
      );
  }
}

// Simple implementations for now (to be moved to separate files if needed)

function StatusWidget({ message, severity = 'info' }: { message: string, severity?: string }) {
  const colors = {
    info: 'bg-blue-500/10 text-blue-600 border-blue-200/50',
    success: 'bg-emerald-500/10 text-emerald-600 border-emerald-200/50',
    error: 'bg-rose-500/10 text-rose-600 border-rose-200/50'
  } as any;
  
  return (
    <div className={`px-3 py-1.5 rounded-lg border text-xs font-medium animate-fade-in ${colors[severity] || colors.info}`}>
      {message}
    </div>
  );
}

function TextWidget({ value }: { value: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
      {value}
    </div>
  );
}

function ApprovalCardWidget({ title, summary, details, rawPayload, approveAction, denyAction, onAction }: any) {
  return (
    <div className="bg-background border border-border/60 rounded-xl overflow-hidden shadow-sm animate-fade-in my-2">
      <div className="p-4 border-b border-border/40 bg-muted/5">
        <h4 className="text-[13px] font-bold text-foreground/80">{title}</h4>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">{summary}</p>
        
        {details && details.length > 0 && (
          <div className="grid grid-cols-1 gap-2 bg-muted/10 p-3 rounded-lg border border-border/20">
            {details.map((detail: any, idx: number) => (
              <div key={idx} className="flex gap-2 text-[11px]">
                <span className="font-bold text-muted-foreground/60 w-24 shrink-0">{detail.label}:</span>
                <span className="text-foreground/70 break-all">{detail.value}</span>
              </div>
            ))}
          </div>
        )}
        
        {rawPayload && (
          <details className="group">
            <summary className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 cursor-pointer hover:text-muted-foreground/60 transition-colors list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform">▸</span>
              View Payload
            </summary>
            <pre className="mt-2 text-[10px] bg-muted/30 p-3 rounded border border-border/10 font-mono text-muted-foreground overflow-auto max-h-40">
              {rawPayload}
            </pre>
          </details>
        )}
      </div>
      <div className="px-4 py-3 bg-muted/5 border-t border-border/40 flex justify-end gap-2">
        <button 
          onClick={() => onAction(denyAction)}
          className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          Deny
        </button>
        <button 
          onClick={() => onAction(approveAction)}
          className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-foreground text-background rounded-md hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function ResourceCardWidget({ title, subtitle, children }: any) {
  return (
    <div className="bg-background border border-border/60 rounded-xl overflow-hidden shadow-sm my-2">
      <div className="p-4 border-b border-border/40 flex flex-col gap-0.5">
        <h4 className="text-[13px] font-bold text-foreground/80">{title}</h4>
        {subtitle && <p className="text-[11px] text-muted-foreground/60">{subtitle}</p>}
      </div>
      <div className="p-4 space-y-3">
        {children && children.map((child: UIBlock, idx: number) => (
          <WidgetRenderer key={idx} block={child} />
        ))}
      </div>
    </div>
  );
}

function DataTableWidget({ headers, rows }: any) {
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden my-2 overflow-x-auto">
      <table className="w-full text-left text-[11px] border-collapse">
        <thead className="bg-muted/30 border-b border-border/40">
          <tr>
            {headers.map((h: string, idx: number) => (
              <th key={idx} className="px-3 py-2 font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {rows.map((row: any[], rIdx: number) => (
            <tr key={rIdx} className="hover:bg-muted/5 transition-colors">
              {row.map((cell: any, cIdx: number) => (
                <td key={cIdx} className="px-3 py-2 text-foreground/70">{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueWidget({ title, data }: any) {
  return (
    <div className="bg-background border border-border/60 rounded-xl overflow-hidden shadow-sm my-2">
      <div className="p-4 border-b border-border/40">
        <h4 className="text-[13px] font-bold text-foreground/80">{title}</h4>
      </div>
      <div className="p-4 grid grid-cols-1 gap-1.5">
        {Object.entries(data).map(([key, value], idx) => (
          <div key={idx} className="flex gap-2 text-[11px]">
            <span className="font-bold text-muted-foreground/60 w-24 shrink-0">{key}:</span>
            <span className="text-foreground/70">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataBlockWidget({ data }: any) {
  return (
    <div className="flex flex-col gap-1 my-1">
      {Object.entries(data).map(([key, value], idx) => (
        <div key={idx} className="flex gap-2 text-[11px]">
          <span className="font-semibold text-muted-foreground/50 w-20 shrink-0">{key}:</span>
          <span className="text-foreground/60">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressStepWidget({ currentStep, totalSteps, label }: any) {
  return (
    <div className="flex items-center gap-3 p-2 bg-muted/5 rounded-lg border border-border/20 my-1">
      <div className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
        {currentStep} / {totalSteps}
      </div>
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function ActionListWidget({ title, actions, onAction }: any) {
  return (
    <div className="bg-background border border-border/60 rounded-xl overflow-hidden shadow-sm my-2">
      <div className="p-4 border-b border-border/40 bg-muted/5">
        <h4 className="text-[13px] font-bold text-foreground/80">{title}</h4>
      </div>
      <div className="p-4 flex flex-wrap gap-2">
        {actions.map((a: any, idx: number) => (
          <button
            key={idx}
            onClick={() => onAction(a.action)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${
              a.variant === 'primary' 
                ? 'bg-foreground text-background hover:opacity-90' 
                : 'border border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyStateWidget({ message, iconName }: any) {
  return (
    <div className="p-8 border border-dashed border-border/60 rounded-xl bg-muted/5 flex flex-col items-center justify-center gap-3 my-4">
      <div className="text-2xl opacity-20">{iconName || '∅'}</div>
      <div className="text-xs text-muted-foreground/60 font-medium">{message}</div>
    </div>
  );
}

function CodeSnippetWidget({ code, language }: any) {
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-border/40 bg-[#0d1117]">
      <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex justify-between items-center">
        <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">{language}</span>
      </div>
      <pre className="p-4 text-[12px] font-mono text-[#e6edf3] overflow-auto max-h-[400px]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownWidget({ value }: { value: string }) {
  // Simple markdown renderer for now, or use a library
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed">
      {value}
    </div>
  );
}

function TodoListWidget({ todos }: { todos: any[] }) {
  if (!todos || !Array.isArray(todos)) return null;

  return (
    <div className="flex flex-col gap-1 w-full my-2 animate-fade-in">
      {todos.map((todo, idx) => {
        const status = (todo.status || '').toLowerCase();
        const isDone = ['completed', 'done', 'finished', 'complete', 'success'].includes(status);
        const isInProgress = ['in_progress', 'in-progress', 'processing', 'running', 'active'].includes(status);
        const isCancelled = ['cancelled', 'canceled', 'failed', 'error'].includes(status);
        const label = todo.content || todo.task || todo.title;

        return (
          <div 
            key={todo.id || idx} 
            className={cn(
              "flex items-center gap-3 py-1.5 px-3 rounded-lg transition-all group",
              isDone ? "opacity-50" : "hover:bg-muted/30"
            )}
          >
            <div className="shrink-0 flex items-center justify-center size-4">
              {isDone ? (
                <div className="size-4 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              ) : isInProgress ? (
                <div className="size-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              ) : isCancelled ? (
                 <div className="size-4 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                   <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-rose-500">
                     <line x1="18" y1="6" x2="6" y2="18" />
                     <line x1="6" y1="6" x2="18" y2="21" />
                   </svg>
                 </div>
              ) : (
                <div className="size-4 rounded-full border-2 border-muted-foreground/20 group-hover:border-primary/40 transition-colors" />
              )}
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className={cn(
                "text-[12.5px] font-medium leading-relaxed truncate",
                isDone ? "text-muted-foreground line-through decoration-muted-foreground/30" : "text-foreground/80"
              )}>
                {label}
              </div>
              
              {todo.assignedAgent && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Agent:</span>
                  <span className="text-[9px] font-semibold text-primary/50">{todo.assignedAgent}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

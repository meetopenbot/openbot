import { cn } from '../../lib/utils';
import { ChevronLeft, Settings2, Variable, Puzzle, Cpu } from 'lucide-react';

export type SettingsSection = 'general' | 'variables' | 'plugins' | 'system';

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: any }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'variables', label: 'Variables', icon: Variable },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'system', label: 'System', icon: Cpu },
];

interface SettingsSidebarProps {
  currentSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onBack: () => void;
}

export function SettingsSidebar({ currentSection, onSectionChange, onBack }: SettingsSidebarProps) {
  return (
    <div className="flex flex-col h-full w-full border-r border-border/50 bg-background">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border/50 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-2 py-1.5 -ml-1 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all duration-150 group"
          title="Back to chat"
        >
          <ChevronLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          <span className="text-[13px] font-medium">Back</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        <div className="px-2.5 mb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Settings
          </span>
        </div>

        <div className="flex flex-col gap-px">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSectionChange(section.id)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-2.5 h-8 rounded-md text-left text-[13px] transition-all duration-150',
                  currentSection === section.id
                    ? 'bg-muted/60 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'size-[18px] shrink-0',
                    currentSection === section.id ? 'text-foreground' : 'text-muted-foreground/70',
                  )}
                />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

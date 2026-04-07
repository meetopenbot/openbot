import { useMemo } from 'react';
import { useConfig } from '../../hooks/use-config';
import { useSession } from '../../hooks/use-session';
import type { SettingsSection } from '../layout/SettingsSidebar';
import { GeneralSettings } from '../settings/GeneralSettings';
import { VariableSettings } from '../settings/VariableSettings';
import { PluginSettings } from '../settings/PluginSettings';
import { SystemSettings } from '../settings/SystemSettings';

export function SettingsPage({
  defaultSection,
  currentSection,
  onSectionChange,
}: {
  defaultSection?: SettingsSection;
  currentSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  return (
    <SettingsPageWithSections
      defaultSection={defaultSection}
      currentSection={currentSection}
      onSectionChange={onSectionChange}
    />
  );
}

function resolveSettingsSection(raw: string | null): SettingsSection {
  if (
    raw === 'general' ||
    raw === 'variables' ||
    raw === 'plugins' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'general';
}

function SettingsPageWithSections({
  defaultSection,
  currentSection,
  onSectionChange,
}: {
  defaultSection?: SettingsSection;
  currentSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const { path, navigate } = useSession();
  const { data: config } = useConfig();

  const settingsSection = useMemo(() => {
    if (currentSection) return currentSection;
    const params = new URLSearchParams(path);
    const fromQuery = resolveSettingsSection(params.get('settingsSection'));
    if (params.has('settingsSection')) return fromQuery;
    return defaultSection ?? 'general';
  }, [path, defaultSection, currentSection]);

  const setSettingsSection = (section: SettingsSection) => {
    if (onSectionChange) {
      onSectionChange(section);
      return;
    }
    const params = new URLSearchParams(path);
    params.set('tab', 'settings');
    params.set('settingsSection', section);
    navigate(`/?${params.toString()}`);
  };

  if (!config) return null;

  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-full">
        <div className="flex-1 min-w-0 h-full">
          <div className="h-full overflow-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10 animate-in fade-in">
              {settingsSection === 'general' && (
                <GeneralSettings setSettingsSection={setSettingsSection} />
              )}
              {settingsSection === 'variables' && (
                <VariableSettings />
              )}
              {settingsSection === 'plugins' && (
                <PluginSettings />
              )}
              {settingsSection === 'system' && (
                <SystemSettings />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

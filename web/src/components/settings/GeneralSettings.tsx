import { useTheme } from '../ThemeProvider';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

type Theme = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

export function GeneralSettings({ setSettingsSection }: { setSettingsSection: (section: any) => void }) {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [profileDraft, setProfileDraft] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const { data: profileData } = useQuery({
    queryKey: ['userProfile'],
    queryFn: api.getUserProfile,
  });

  useEffect(() => {
    if (profileData?.profile != null) {
      setProfileDraft(profileData.profile);
    }
  }, [profileData]);

  const saveProfileMutation = useMutation({
    mutationFn: () => api.updateUserProfile(profileDraft),
    onSuccess: async () => {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  const handleProfileSave = useCallback(() => {
    saveProfileMutation.mutate();
  }, [saveProfileMutation]);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">General</h2>
        <p className="text-[13px] text-muted-foreground/70">
          Appearance and theme preferences.
        </p>
      </div>
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium">Appearance</h3>
          <p className="text-xs text-muted-foreground/60">
            Choose your preferred color theme
          </p>
        </div>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                theme === opt.value
                  ? 'border-foreground/15 bg-foreground/4 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                  : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <ThemeIcon type={opt.icon} />
              {opt.label}
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium">User Profile</h3>
          <p className="text-xs text-muted-foreground/60">
            Tell OpenBot about yourself. All agents read this to personalize their
            responses. Stored locally in{' '}
            <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
              ~/.openbot/USER.md
            </code>
          </p>
        </div>
        <Textarea
          value={profileDraft}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setProfileDraft(e.target.value)}
          placeholder="Tell agents about yourself — your name, preferences, projects, how you like to work..."
          rows={8}
          className="font-mono text-xs resize-y"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={
              saveProfileMutation.isPending ||
              profileDraft === (profileData?.profile ?? '')
            }
            onClick={handleProfileSave}
          >
            {profileSaved
              ? 'Saved'
              : saveProfileMutation.isPending
                ? 'Saving...'
                : 'Save profile'}
          </Button>
          {profileDraft !== (profileData?.profile ?? '') && (
            <span className="text-[11px] text-muted-foreground/50">
              Unsaved changes
            </span>
          )}
        </div>
      </section>
      <p className="text-xs text-muted-foreground/60">
        Provider API keys: use{' '}
        <button
          type="button"
          onClick={() => setSettingsSection('variables')}
          className="font-medium text-foreground/80 underline decoration-border/60 underline-offset-2 hover:text-foreground"
        >
          Variables
        </button>{' '}
        to set <code className="text-[11px]">OPENAI_API_KEY</code> and{' '}
        <code className="text-[11px]">ANTHROPIC_API_KEY</code>.
      </p>
    </>
  );
}

function ThemeIcon({ type }: { type: string }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (type === 'sun')
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );

  if (type === 'moon')
    return (
      <svg {...props}>
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    );

  return (
    <svg {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MarketplaceItem } from '../../lib/api';
import { ExtensionItem } from '../ExtensionItem';

export function PluginSettings() {
  const queryClient = useQueryClient();
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const { data: plugins = [], isLoading: loadingPlugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: api.getInstalledPlugins,
  });

  const { data: marketplacePlugins = [], isLoading: loadingMarketplacePlugins } = useQuery({
    queryKey: ['marketplace', 'plugins'],
    queryFn: api.getMarketplacePlugins,
  });

  const installedPluginKeys = useMemo(() => {
    return new Set(
      plugins.map((plugin) => [plugin.id, plugin.name].map((v) => (v || '').toLowerCase())).flat(),
    );
  }, [plugins]);

  const isPluginInstalled = (item: MarketplaceItem) =>
    installedPluginKeys.has(item.id.toLowerCase()) ||
    installedPluginKeys.has(item.name.toLowerCase());

  const handleInstallPlugin = async (item: MarketplaceItem) => {
    setInstallError(null);
    setInstallingPluginId(item.id);
    try {
      await api.installMarketplacePlugin(item.id);
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'plugins'] });
    } catch (err) {
      console.error(err);
      setInstallError(`Failed to install plugin "${item.name}"`);
    } finally {
      setInstallingPluginId(null);
    }
  };

  const recommendedPlugins = useMemo(() => {
    return marketplacePlugins.filter(
      (item) => item.tags?.includes('recommended') && !isPluginInstalled(item),
    );
  }, [marketplacePlugins, installedPluginKeys]);

  const otherMarketplacePlugins = useMemo(() => {
    return marketplacePlugins.filter(
      (item) => !item.tags?.includes('recommended') && !isPluginInstalled(item),
    );
  }, [marketplacePlugins, installedPluginKeys]);

  return (
    <section className="flex flex-col gap-6 pb-20">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Plugins</h2>
        <p className="text-[13px] text-muted-foreground/70">
          Install and manage system extensions.
        </p>
      </div>
      {installError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {installError}
        </p>
      )}
      <div className="flex flex-col gap-8">
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
            Installed
          </h4>
          {loadingPlugins ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1 -mx-3 md:grid-cols-2">
              {plugins.map((plugin) => (
                <ExtensionItem
                  key={plugin.id}
                  id={plugin.id}
                  name={plugin.name}
                  description={plugin.description}
                  type="plugin"
                  isInstalled
                  image={plugin.image}
                />
              ))}
              {plugins.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border/50 mx-3">
                  No plugins installed.
                </div>
              )}
            </div>
          )}
        </div>
        {recommendedPlugins.length > 0 && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
              Recommended
            </h4>
            <div className="grid grid-cols-1 gap-1 -mx-3 md:grid-cols-2">
              {recommendedPlugins.map((item) => (
                <ExtensionItem
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  type="plugin"
                  image={item.image}
                  onInstall={() => handleInstallPlugin(item)}
                  isInstalling={installingPluginId === item.id}
                />
              ))}
            </div>
          </div>
        )}
        {otherMarketplacePlugins.length > 0 && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
              Marketplace
            </h4>
            {loadingMarketplacePlugins ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 -mx-3 md:grid-cols-2">
                {otherMarketplacePlugins.map((item) => (
                  <ExtensionItem
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    description={item.description}
                    type="plugin"
                    image={item.image}
                    onInstall={() => handleInstallPlugin(item)}
                    isInstalling={installingPluginId === item.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

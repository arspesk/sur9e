'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/behavior/popover';
import { useProviderInfo } from '@/hooks/use-provider-info';
import { useSettingsQuery } from '@/hooks/use-settings';
import { DRAFT_OVERRIDE_KEY, useChatStore } from '@/stores/chat-store';

/** Model chip: a spark glyph + the actual model name (no CLI/provider
 * prefix). The resolved pair mirrors the server's resolveModeRuntime waterfall:
 * per-conversation override → settings modes.chat → global default pair → hard
 * fallback. Picking a pair stores it per-conversation (DRAFT key
 * pre-conversation); the send flow posts it on every turn. */
export function ModelChip() {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeId = useChatStore(s => s.activeConversationId);
  const overrideKey = activeId ?? DRAFT_OVERRIDE_KEY;
  const override = useChatStore(s => s.modelOverride[overrideKey]);
  const setModelOverride = useChatStore(s => s.setModelOverride);
  const { data: providerInfo } = useProviderInfo();
  const { data: settings } = useSettingsQuery();

  const chatMode = settings?.providers?.modes?.chat;
  const provider =
    override?.provider ?? chatMode?.platform ?? settings?.providers?.default_provider ?? 'claude';
  const model =
    override?.model ?? chatMode?.model ?? settings?.providers?.default_model ?? 'claude-sonnet-4-6';

  // The ACTUAL parsed model name — the provider's own label (which
  // distinguishes same-family variants like two 'Haiku 4.5' builds), falling
  // back to the raw id before the provider list loads.
  const currentLabel = Object.values(providerInfo?.providers ?? {})
    .find(e => e.id === provider)
    ?.models.find(m => m.id === model)?.label;
  const displayName = currentLabel ?? model;

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="chat-model-chip"
          aria-label={`Model: ${displayName} — change model`}
          title={displayName}
        >
          <Sparkles
            className="chat-model-chip__spark"
            size={14}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="chat-model-chip__name">{displayName}</span>
          <ChevronDown
            className="chat-model-chip__caret"
            size={13}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="chat-model-menu">
        {Object.values(providerInfo?.providers ?? {}).map(entry => {
          const installed = entry.installed.ok;
          return (
            <div key={entry.id} className="chat-model-menu__group">
              <div className="chat-model-menu__label">
                {entry.displayName}
                {!installed && <span className="chat-model-menu__missing"> · not installed</span>}
              </div>
              {entry.models.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className="chat-model-menu__item"
                  disabled={!installed}
                  data-active={entry.id === provider && m.id === model ? 'true' : undefined}
                  onClick={() => {
                    setModelOverride(overrideKey, { provider: entry.id, model: m.id });
                    setMenuOpen(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          );
        })}
        {!providerInfo && <p className="chat-model-menu__empty">Loading models…</p>}
      </PopoverContent>
    </Popover>
  );
}

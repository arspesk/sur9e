'use client';

// Empty-state + setup-card presentation shared by every chat surface (the
// corner bubble card, the /chat page, and the Home hero's greeting). Moved
// out of chat-card.tsx unchanged when useConversation was extracted.

import { useEffect, useState } from 'react';
import { useProfileQuery } from '@/hooks/use-profile';
import { ChatBrandMark } from './brand-mark';
import { ChatSuggestions } from './chat-suggestions';

/** Backend refused with the onboarding-preflight shape (setupRequired). */
export function SetupCard() {
  return (
    <div className="chat-setup">
      <ChatBrandMark size={22} className="chat-setup__mark" />
      <p className="chat-setup__title">Almost there</p>
      <p className="chat-setup__body">
        Chat needs your CV and profile. Finish setup in your terminal first:
      </p>
      <code className="chat-setup__cmd">npm run setup</code>
    </div>
  );
}

export function timeGreeting(hour: number): { text: string; emoji: string } {
  if (hour < 5) return { text: 'Good evening', emoji: '🌙' };
  if (hour < 12) return { text: 'Good morning', emoji: '🌅' };
  if (hour < 18) return { text: 'Good afternoon', emoji: '☀️' };
  return { text: 'Good evening', emoji: '🌙' };
}

/** Time-of-day greeting + data-grounded conversation starters. */
export function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { data: profile } = useProfileQuery();
  const firstName = profile?.candidate?.full_name?.trim().split(/\s+/)[0] ?? '';
  // Resolve the time-of-day greeting AFTER mount: the server render and the
  // first client render both use the empty fallback (so hydration matches),
  // then the effect swaps in the greeting for the user's actual local time.
  const [greeting, setGreeting] = useState<{ text: string; emoji: string } | null>(null);
  useEffect(() => {
    setGreeting(timeGreeting(new Date().getHours()));
  }, []);

  let heading: string;
  if (greeting) {
    const base = firstName ? `${greeting.text}, ${firstName}` : greeting.text;
    heading = `${base} ${greeting.emoji}`;
  } else {
    heading = firstName ? `Welcome back, ${firstName}` : 'Start with a question';
  }

  return (
    <div className="chat-empty chat-empty--starters">
      <p className="chat-empty__label">{heading}</p>
      <ChatSuggestions onPick={onPick} />
    </div>
  );
}

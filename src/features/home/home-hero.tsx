'use client';

// Chat hero: greeting + the real composer (attachments, / modes, @ mentions,
// model chip) + data-grounded suggestion chips. Sending creates the session
// and starts the turn via useConversation, then navigates to /chat where the
// stream reattaches (persisted-turn probe, replay from seq 0).

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatComposer } from '@/features/chat/chat-composer';
import { timeGreeting } from '@/features/chat/chat-empty-state';
import { ChatSuggestions } from '@/features/chat/chat-suggestions';
import { useConversation } from '@/features/chat/use-conversation';
import { useProfileQuery } from '@/hooks/use-profile';
import { useChatStore } from '@/stores/chat-store';

export function HomeHero() {
  const router = useRouter();
  const convo = useConversation({ onAfterSend: () => router.push('/chat') });
  const { data: profile } = useProfileQuery();
  const firstName = profile?.candidate?.full_name?.trim().split(/\s+/)[0] ?? '';
  const setActiveConversation = useChatStore(s => s.setActiveConversation);

  // Landing on Home means "new question" — never inherit whatever thread the
  // bubble was last on, so the hero always composes into a fresh chat.
  useEffect(() => {
    setActiveConversation(null);
  }, [setActiveConversation]);

  // Post-mount greeting so SSR and the first client render match (same
  // pattern as ChatEmptyState).
  const [greeting, setGreeting] = useState<{ text: string; emoji: string } | null>(null);
  useEffect(() => {
    setGreeting(timeGreeting(new Date().getHours()));
  }, []);
  const heading = greeting
    ? `${firstName ? `${greeting.text}, ${firstName}` : greeting.text} ${greeting.emoji}`
    : firstName
      ? `Welcome back, ${firstName}`
      : 'Start with a question';

  return (
    <div className="home-hero">
      <h1 className="home-hero__greeting">{heading}</h1>
      <div className="home-hero__composer">
        <ChatComposer
          streaming={convo.streaming}
          files={convo.draftFiles}
          onFilesChange={convo.setDraftFiles}
          onSend={(text, refs) => void convo.send(text, refs)}
          onStop={() => void convo.stop()}
        />
      </div>
      <div className="home-hero__chips">
        <ChatSuggestions onPick={text => void convo.send(text)} />
      </div>
    </div>
  );
}

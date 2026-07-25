import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChatPage } from '@/features/chat/chat-page';

// Conversation ids are uuids (the same guard the chat API routes apply before
// touching the store) — anything else is a bad link, not an empty thread.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: 'sur9e — Chat',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const conversationId = decodeURIComponent(id);
  if (!UUID_RE.test(conversationId)) notFound();

  return <ChatPage conversationId={conversationId} />;
}

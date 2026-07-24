import type { Metadata } from 'next';
import { ChatPage } from '@/features/chat/chat-page';

export const metadata: Metadata = {
  title: 'sur9e — Chat',
};

export default function Page() {
  return <ChatPage />;
}

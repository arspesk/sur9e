import { ChatComposerSkeleton, ChatTranscriptSkeleton } from './chat-skeleton';

function ThreadsSkeleton() {
  return (
    <aside className="chat-threads chat-threads--skeleton" aria-hidden="true">
      <div className="chat-threads__head">
        <span className="sk chat-threads-skeleton__new-icon" />
        <span className="sk chat-threads-skeleton__new-label" />
      </div>
      <div className="chat-threads__divider" />
      <div className="chat-threads__list">
        <span className="sk chat-threads-skeleton__group" />
        {[72, 88, 64, 78].map(width => (
          <span
            key={width}
            className="sk chat-threads-skeleton__row"
            style={{ width: `${width}%` }}
          />
        ))}
        <span className="sk chat-threads-skeleton__group" />
        {[82, 68].map(width => (
          <span
            key={width}
            className="sk chat-threads-skeleton__row"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </aside>
  );
}

export function ChatPageSkeleton() {
  return (
    <div className="chat-page">
      <ThreadsSkeleton />
      <section className="chat-page__main" aria-label="Conversation">
        <header className="chat-page__header" aria-hidden="true">
          <span className="sk chat-page-skeleton__title" />
        </header>
        <div className="chat-page__body">
          <ChatTranscriptSkeleton />
        </div>
        <div className="chat-page__composer">
          <ChatComposerSkeleton />
        </div>
      </section>
    </div>
  );
}

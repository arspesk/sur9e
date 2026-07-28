export function ChatTranscriptSkeleton() {
  return (
    <div
      className="chat-transcript chat-transcript--skeleton"
      role="status"
      aria-label="Loading conversation"
      aria-busy="true"
    >
      <div className="chat-skeleton-message chat-skeleton-message--assistant" aria-hidden="true">
        <span className="sk chat-skeleton-line chat-skeleton-line--long" />
        <span className="sk chat-skeleton-line chat-skeleton-line--medium" />
        <span className="sk chat-skeleton-line chat-skeleton-line--short" />
      </div>
      <div className="chat-skeleton-message chat-skeleton-message--user" aria-hidden="true">
        <span className="sk chat-skeleton-line chat-skeleton-line--medium" />
        <span className="sk chat-skeleton-line chat-skeleton-line--short" />
      </div>
      <div className="chat-skeleton-message chat-skeleton-message--assistant" aria-hidden="true">
        <span className="sk chat-skeleton-line chat-skeleton-line--long" />
        <span className="sk chat-skeleton-line chat-skeleton-line--medium" />
      </div>
    </div>
  );
}

export function ChatComposerSkeleton() {
  return (
    <div className="chat-composer chat-composer--skeleton" aria-hidden="true">
      <div className="chat-composer__box">
        <span className="sk chat-composer-skeleton__input" />
        <div className="chat-composer__tools">
          <span className="sk chat-composer-skeleton__tool" />
          <span className="chat-composer__tools-spacer" />
          <span className="sk chat-composer-skeleton__model" />
          <span className="sk chat-composer-skeleton__send" />
        </div>
      </div>
    </div>
  );
}

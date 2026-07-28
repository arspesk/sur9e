import { Topbar } from '@/components/shell/topbar';
import { ChatComposerSkeleton } from '@/features/chat/chat-skeleton';

function AgendaSkeleton() {
  return (
    <div className="agenda-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="card agenda-card home-skeleton__agenda" key={index}>
          <span className="sk home-skeleton__count" />
          <span className="sk home-skeleton__agenda-label" />
          <span className="sk home-skeleton__agenda-cta" />
        </div>
      ))}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <section className="home-section" aria-hidden="true">
      <span className="sk home-skeleton__section-label" />
      {Array.from({ length: 3 }, (_, index) => (
        <div className="home-row home-row--skeleton" key={index}>
          <span className="sk home-skeleton__avatar" />
          <span className="home-row__text">
            <span className="sk home-skeleton__row-title" />
            <span className="sk home-skeleton__row-meta" />
          </span>
          <span className="sk home-skeleton__row-action" />
        </div>
      ))}
    </section>
  );
}

export function HomeSkeleton() {
  return (
    <>
      <Topbar crumbs={[{ label: 'Workspace' }]} />
      <div className="home" role="status" aria-label="Loading Home" aria-busy="true">
        <div className="home-hero" aria-hidden="true">
          <span className="sk home-skeleton__greeting" />
          <div className="home-hero__composer">
            <ChatComposerSkeleton />
          </div>
          <div className="home-hero__chips home-skeleton__chips">
            <span className="sk" />
            <span className="sk" />
            <span className="sk" />
          </div>
        </div>
        <AgendaSkeleton />
        <div className="home-columns">
          <QueueSkeleton />
          <QueueSkeleton />
        </div>
      </div>
    </>
  );
}

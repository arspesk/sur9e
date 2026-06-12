'use client';

/**
 * components/modal-host.tsx
 *
 * Central modal switcher. Reads the current modal name from useModalStore
 * and renders the matching component from the registry below. Each modal
 * owns its own dialog markup (backdrop, focus trap, Esc handler) so the
 * host stays a one-line dispatcher.
 *
 * 'delete' is intentionally NOT registered here — DeleteConfirmModal lives
 * directly in layout.tsx and uses its own promise-based store
 * (useDeleteConfirmStore). Routing it through this registry would either
 * double-mount or break the Promise contract.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { type ModalName, useModalStore } from '@/stores/modal-store';
import { ApplyModal } from './modals/apply-modal';
import { CoverLetterModal } from './modals/cover-letter-modal';
import { CvModal } from './modals/cv-modal';
import { EvaluateModal } from './modals/evaluate-modal';
import { FollowupModal } from './modals/followup-modal';
import { InterviewProcessModal } from './modals/interview-process-modal';
import { NegotiateModal } from './modals/negotiate-modal';
import { OutreachModal } from './modals/outreach-modal';
import { ResearchModal } from './modals/research-modal';
import { ScreenModal } from './modals/screen-modal';

type RegistryKey = Exclude<ModalName, null | 'delete'>;

const REGISTRY: Record<RegistryKey, React.ComponentType> = {
  apply: ApplyModal,
  cv: CvModal,
  'cover-letter': CoverLetterModal,
  evaluate: EvaluateModal,
  followup: FollowupModal,
  'interview-process': InterviewProcessModal,
  negotiate: NegotiateModal,
  outreach: OutreachModal,
  research: ResearchModal,
  screen: ScreenModal,
};

export function ModalHost() {
  const modal = useModalStore(s => s.modal);
  const close = useModalStore(s => s.close);

  // Close any open confirmation modal when the route changes (back/forward
  // included) — the store is global, so without this a modal opened on one
  // page survives navigation and floats over the next page. The loading-modal
  // deck is intentionally NOT affected (separate store; cross-page by design).
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      close();
    }
  }, [pathname, close]);

  if (!modal || modal === 'delete') return null;
  const Component = REGISTRY[modal];
  if (!Component) return null;
  return <Component />;
}

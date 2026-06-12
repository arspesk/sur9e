'use client';

// onCvContent lifts CV-file-presence state up to the orchestrator so
// the required-field banner can include the "CV markdown" rule (the
// MdSection content itself lives outside rhf — see md-section.tsx).

import { MdSection } from './_widgets/md-section';

interface CvSectionProps {
  onCvContent: (hasContent: boolean) => void;
}

export function CvSection({ onCvContent }: CvSectionProps) {
  return (
    <section id="cv" className="form-section anim-enter">
      <h2 className="form-section__title">
        CV{' '}
        <span className="form-required" aria-hidden="true">
          *
        </span>
      </h2>
      <p className="form-section__desc">Your canonical CV — every tailored PDF starts from this.</p>
      <MdSection name="cv" niceName="CV markdown" onCvContent={onCvContent} />
    </section>
  );
}

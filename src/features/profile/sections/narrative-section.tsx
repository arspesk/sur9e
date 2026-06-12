'use client';

import { MdSection } from './_widgets/md-section';

export function NarrativeSection() {
  return (
    <section id="narrative" className="form-section anim-enter">
      <h2 className="form-section__title">Narrative</h2>
      <p className="form-section__desc">
        Per-archetype framing, your cross-cutting advantage, and negotiation scripts.
      </p>
      <MdSection name="narrative" niceName="Narrative markdown" />
    </section>
  );
}

'use client';

import { MdSection } from './_widgets/md-section';

export function DigestSection() {
  return (
    <section id="digest" className="form-section anim-enter">
      <h2 className="form-section__title">Article digest</h2>
      <p className="form-section__desc">
        Optional proof-point library — articles and work that back up your claims.
      </p>
      <MdSection name="article-digest" niceName="Article digest markdown" />
    </section>
  );
}

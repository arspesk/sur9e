import type { HTMLAttributes, LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface LabelBaseProps {
  /**
   * Opt out of the hardcoded `form-field__label` base class. Use when the
   * consumer needs a bespoke label style without the default field-form chrome.
   */
  bare?: boolean;
}

interface LabelAsLabelProps extends LabelHTMLAttributes<HTMLLabelElement>, LabelBaseProps {
  /**
   * Render as a <label>. Default — supports `htmlFor` to associate with a
   * single input control.
   */
  as?: 'label';
}

interface LabelAsSpanProps extends HTMLAttributes<HTMLSpanElement>, LabelBaseProps {
  /**
   * Render as a <span>. Use when the label is a caption for a group of
   * controls (radiogroup, segmented control, rowlist) where there's no
   * single `htmlFor` target — the group itself carries `aria-labelledby`
   * pointing at this span's id.
   */
  as: 'span';
}

type LabelProps = LabelAsLabelProps | LabelAsSpanProps;

export function Label(props: LabelProps) {
  const { bare, className, ...rest } = props;
  const classes = cn(!bare && 'form-field__label', className);

  if (props.as === 'span') {
    // Strip `as` before spread so it doesn't land on the DOM node.
    const { as: _as, ...spanProps } = rest as LabelAsSpanProps;
    return <span className={classes} {...spanProps} />;
  }

  const { as: _as, ...labelProps } = rest as LabelAsLabelProps;
  return <label className={classes} {...labelProps} />;
}

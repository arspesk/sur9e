import { X } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ForwardRefExoticComponent,
  HTMLAttributes,
  ReactNode,
  Ref,
  RefAttributes,
} from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface BaseChipProps {
  children: ReactNode;
  className?: string;
  onRemove?: () => void;
}

// Static span chip — non-interactive (label/tag style).
type StaticChipProps = BaseChipProps &
  Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'children'> & {
    interactive?: false;
  };

// Interactive chip — renders as <button type="button"> so the whole chip
// is the click target (used for active-filter pills where clicking the
// pill removes the filter). Forwards every ButtonHTMLAttributes member.
type InteractiveChipProps = BaseChipProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'type'> & {
    interactive: true;
  };

export type ChipProps = StaticChipProps | InteractiveChipProps;

function ChipImpl(props: ChipProps, ref: Ref<HTMLButtonElement | HTMLSpanElement>): ReactNode {
  const { children, className, onRemove } = props;
  const removeButton = onRemove ? (
    <button type="button" aria-label="Remove" onClick={onRemove} className="chip__remove">
      <X size={14} aria-hidden="true" />
    </button>
  ) : null;

  if (props.interactive) {
    const {
      interactive: _interactive,
      children: _children,
      className: _cn,
      onRemove: _onRemove,
      ...rest
    } = props;
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={cn('chip', 'chip--interactive', className)}
        {...rest}
      >
        {children}
        {removeButton}
      </button>
    );
  }

  const {
    interactive: _interactive,
    children: _children,
    className: _cn,
    onRemove: _onRemove,
    ...rest
  } = props;
  return (
    <span ref={ref as Ref<HTMLSpanElement>} className={cn('chip', className)} {...rest}>
      {children}
      {removeButton}
    </span>
  );
}

type ChipComponent = ForwardRefExoticComponent<
  | (Omit<StaticChipProps, 'ref'> & RefAttributes<HTMLSpanElement>)
  | (Omit<InteractiveChipProps, 'ref'> & RefAttributes<HTMLButtonElement>)
>;

export const Chip = forwardRef(ChipImpl) as ChipComponent;
(Chip as { displayName?: string }).displayName = 'Chip';

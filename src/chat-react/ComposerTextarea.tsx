import type { ComponentProps } from "react";

type Props = ComponentProps<"textarea"> & { minRows?: number; maxRows?: number };

// The hidden copy wraps at the same width as the input, even when the font or
// viewport changes. The trailing space gives an empty final line its height.
export default function ComposerTextarea({ minRows, maxRows, ...props }: Props) {
  return <div className="mc-input-wrap">
    <span className="mc-input" aria-hidden="true">{props.value} </span>
    <textarea {...props} />
  </div>;
}

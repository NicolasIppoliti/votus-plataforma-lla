"use client";

import { Children, Fragment, isValidElement, useState, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size">;
type Option = ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
function optionChildren(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<Option["props"]>(child)) return [];
    if (child.type === Fragment || child.type === "optgroup") return optionChildren(child.props.children);
    return child.type === "option" ? [child] : [];
  });
}

/** Keep the native control/keyboard contract; repeat its full value on phones,
 * where browsers cannot wrap the selected option inside a native select. */
export function ResponsiveSelect({ children, value, defaultValue, onChange, ...props }: Props) {
  const [draft, setDraft] = useState(defaultValue);
  const selected = value ?? draft;
  const options = optionChildren(children);
  const optionValue = (option: (typeof options)[number]) => String(option.props.value ?? option.props.children ?? "");
  const option = options.find(candidate => optionValue(candidate) === String(selected)) ?? options.find(candidate => !candidate.props.disabled);

  return <span className="responsive-select">
    <select {...props} value={value} defaultValue={defaultValue} onChange={event => {
      if (value === undefined) setDraft(event.target.value);
      onChange?.(event);
    }}>{children}</select>
    <span className="responsive-select__value" data-mobile-select-value="" aria-hidden="true">{option?.props.children}</span>
  </span>;
}

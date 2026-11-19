import type { ComponentProps } from "react";
import type { WorkflowSchema } from "./workflowParams";
import type { Translate } from "./ChatApp";

export function ParameterField({ field, name, t, ...control }: {
  field: WorkflowSchema["inputSchema"]["properties"][string]; name: string; t: Translate;
  onChange(event: { target: { value: string } }): void;
} & Pick<ComponentProps<"input">, "value" | "required" | "disabled" | "readOnly">) {
  const options = field.enum ?? (field.type === "boolean" ? [true, false] : undefined);
  return <label>{field.description || name}{control.required ? " *" : ""}
    {options && !control.readOnly ? <select {...control}>
      <option value="">{t("chatReact.workflowChoose")}</option>
      {options.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
    </select> : <input {...control} type={field.type === "integer" || field.type === "number" ? "number" : "text"}
      step={field.type === "integer" ? 1 : "any"} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength} />}
  </label>;
}

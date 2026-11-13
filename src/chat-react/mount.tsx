import { createRoot } from "react-dom/client";
import { ChatApp, type ChatProps } from "./ChatApp";

/** Entry of the lazily loaded React chunk; ChatHost.vue owns the element and lifecycle. */
export function mount(element: HTMLElement, props: ChatProps) {
  const root = createRoot(element);
  root.render(<ChatApp {...props} />);
  return {
    update: (next: ChatProps) => root.render(<ChatApp {...next} />),
    unmount: () => root.unmount(),
  };
}

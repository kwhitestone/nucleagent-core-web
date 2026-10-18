export function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget as HTMLDialogElement;
  const controls = [...dialog.querySelectorAll<HTMLElement>(
    "button, input, select, textarea, summary, a[href], [tabindex], [contenteditable='true']",
  )].filter(element => element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest("[inert]") && element.getClientRects().length > 0 &&
    !["hidden", "collapse"].includes(element.ownerDocument.defaultView!.getComputedStyle(element).visibility))
    .filter(element => {
      // Closed details descendants may still have client rectangles.
      for (let details = element.closest("details:not([open])"); details;
        details = details.parentElement?.closest("details:not([open])") ?? null) {
        if (!details.querySelector(":scope > summary")?.contains(element)) return false;
      }
      return true;
    })
    // Positive tabindex precedes zero; stable sort preserves DOM order for ties.
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
  const first = controls[0], last = controls.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (!first) {
    event.preventDefault();
    dialog.tabIndex = -1;
    dialog.focus();
    return;
  }
  const index = controls.indexOf(active as HTMLElement);
  // Positive stops can hand native traversal to background zero-tabindex controls.
  const target = index < 0 ? (event.shiftKey ? last : first)
    : first.tabIndex > 0 ? controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]
    : event.shiftKey && active === first ? last : !event.shiftKey && active === last ? first : undefined;
  if (target) { event.preventDefault(); target.focus(); }
}

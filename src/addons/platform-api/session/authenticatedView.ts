import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, Teleport, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { SESSION_CHANGE_EVENT, isBusinessBoundaryChange } from "@/contracts/platform-runtime";
import { getAccessToken } from "@/utils/token";
import { revalidating } from "./embeddedAuthorization";

/** Defer business setup/requests until this iframe receives trusted auth. */
export function authenticatedView(view: Component, suspendPaths: readonly string[] = []): Component {
  return defineComponent({
    name: "AuthenticatedBusinessView",
    inheritAttrs: false,
    setup(_, { attrs }) {
      const { t } = useI18n();
      const route = suspendPaths.length ? useRoute() : undefined;
      const authenticated = ref(Boolean(getAccessToken()));
      const generation = ref(0);
      const suspended = ref(false);
      const business = ref<{ $el?: HTMLElement } | null>(null);
      // Detached, memory-only DOM. Only audited non-teleporting editor routes
      // opt in; other views retain the destructive fail-closed behavior.
      const quarantine = suspendPaths.length ? document.createElement("div") : null;
      let focus: HTMLElement | null = null;
      let selection: [number, number] | null = null;
      let modals: HTMLDialogElement[] = [];
      const update = (event: Event) => {
        const wasSuspended = suspended.value;
        const boundary = isBusinessBoundaryChange(event);
        suspended.value = revalidating.value && !!route && suspendPaths.includes(route.path) &&
          (authenticated.value || wasSuspended) && !boundary;
        if (suspended.value && !wasSuspended) {
          modals = Array.from(business.value?.$el?.querySelectorAll<HTMLDialogElement>("dialog:modal") ?? []);
          focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          selection = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement
            ? [focus.selectionStart ?? 0, focus.selectionEnd ?? 0] : null;
        }
        authenticated.value = Boolean(getAccessToken());
        if (boundary) { generation.value += 1; focus = null; selection = null; modals = []; }
        if (wasSuspended && !suspended.value && authenticated.value && !boundary) {
          const current = generation.value;
          void nextTick(() => {
            if (current !== generation.value || revalidating.value || !getAccessToken()) return;
            // Detaching a dialog removes its native top-layer membership.
            for (const dialog of modals) if (dialog.isConnected && dialog.open && !dialog.matches(":modal")) {
              dialog.removeAttribute("open");
              dialog.showModal();
            }
            modals = [];
            if (!focus?.isConnected) { focus = null; selection = null; return; }
            focus.focus({ preventScroll: true });
            if (selection && (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement)) {
              focus.setSelectionRange(...selection);
            }
            focus = null; selection = null;
          });
        }
      };
      if (route) watch(() => route.path, () => {
        if (!suspended.value) return;
        suspended.value = false;
        generation.value++;
        focus = null; selection = null; modals = [];
      }, { flush: "sync" });
      onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, update));
      onBeforeUnmount(() => window.removeEventListener(SESSION_CHANGE_EVENT, update));
      return () => {
        const content = authenticated.value || suspended.value ? h(view, { ...attrs, ref: business, key: generation.value }) : null;
        const status = !authenticated.value ? h("p", { role: "status", style: "padding:32px;color:var(--text-secondary)" },
          suspended.value ? t("common.sessionRevalidating") : t("common.signInRequired")) : null;
        return quarantine
          ? [h(Teleport, { to: quarantine, disabled: !suspended.value }, content ? [content] : []), status]
          : content ?? status;
      };
    },
  });
}

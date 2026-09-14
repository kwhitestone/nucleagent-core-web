import { defineComponent, h, onBeforeUnmount, onMounted, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { getAccessToken } from "@/utils/token";

/** Defer business setup/requests until this iframe receives trusted auth. */
export function authenticatedView(view: Component): Component {
  return defineComponent({
    name: "AuthenticatedBusinessView",
    inheritAttrs: false,
    setup(_, { attrs }) {
      const { t } = useI18n();
      const authenticated = ref(Boolean(getAccessToken()));
      const generation = ref(0);
      const update = () => {
        authenticated.value = Boolean(getAccessToken());
        generation.value += 1;
      };
      onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, update));
      onBeforeUnmount(() => window.removeEventListener(SESSION_CHANGE_EVENT, update));
      return () => authenticated.value
        ? h(view, { ...attrs, key: generation.value })
        : h("p", { role: "status", style: "padding:32px;color:var(--text-secondary)" }, t("common.signInRequired"));
    },
  });
}

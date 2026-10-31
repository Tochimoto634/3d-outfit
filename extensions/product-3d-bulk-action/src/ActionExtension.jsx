import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<Extension />, document.body);
};

/**
 * Admin selection action on Products index.
 * Shows selected product count and links into the embedded Generation Job route.
 */
function Extension() {
  const { i18n, close, data } = shopify;
  const selected = data?.selected || [];
  const ids = selected
    .map((item) => item?.id)
    .filter(Boolean)
    .map((id) => {
      // Prefer numeric id in query for Admin Link compatibility
      const m = String(id).match(/Product\/(\d+)/);
      return m ? m[1] : String(id);
    });

  const href =
    ids.length > 0
      ? `/app/jobs/new?ids=${encodeURIComponent(ids.join(","))}`
      : "/app/jobs/new";

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="base">
        <s-text>
          {i18n.translate("body", { count: String(selected.length) })}
        </s-text>
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="small">
            {selected.slice(0, 12).map((item) => (
              <s-text key={item.id}>{item.id}</s-text>
            ))}
            {selected.length > 12 ? (
              <s-text>+{selected.length - 12}</s-text>
            ) : null}
          </s-stack>
        </s-box>
      </s-stack>

      <s-button slot="primary-action" href={href} variant="primary">
        {i18n.translate("open")}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => close()}>
        {i18n.translate("cancel")}
      </s-button>
    </s-admin-action>
  );
}

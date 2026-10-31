# product-3d-create-link

Admin link for the Products index selection / bulk menu.

Label: **3D作成**

Target: `admin.product-index.selection-action.link`

Opens `/app/jobs/new` in the embedded app. Shopify appends selected resource IDs as query parameters (`ids[]=…` for multi-select, `id=` for single).

Appears under **⋯ → アプリ** on the product index when one or more products are selected.

Product details uses a separate extension (`product-3d-details-link`) because `admin_link` allows only one targeting per extension.

This is the **only** product-index selection entry (the Selection Action UI extension was removed to avoid a duplicate「3D作成」label).

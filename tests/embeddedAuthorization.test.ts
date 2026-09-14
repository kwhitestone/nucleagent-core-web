import assert from "node:assert/strict";
import test from "node:test";

import {
  filterEmbeddedAuthorizedItems,
  hasEmbeddedPermission,
  replaceEmbeddedPermissions,
} from "../src/addons/platform-api/session/embeddedAuthorization.ts";

test("replaces permissions immutably and supports service wildcards", () => {
  assert.equal(replaceEmbeddedPermissions(["core:admin:read", "core:admin:read", "bad"]), true);
  assert.equal(hasEmbeddedPermission("core:admin:read"), true);
  assert.equal(hasEmbeddedPermission("core:admin:write"), false);
  assert.equal(replaceEmbeddedPermissions(["core:*:read"]), true);
  assert.equal(hasEmbeddedPermission("core:provider:read"), true);
  assert.equal(replaceEmbeddedPermissions([]), true);
  assert.equal(hasEmbeddedPermission("core:admin:read"), false);
});

test("standalone admin navigation is not filtered by absent shell permissions", () => {
  const items = [
    { permission: "core:provider:read", path: "/admin/providers" },
    { permission: "core:tool:read", path: "/admin/tools" },
  ];
  assert.deepEqual(filterEmbeddedAuthorizedItems(items, false, () => false), items);
  assert.deepEqual(
    filterEmbeddedAuthorizedItems(items, true, (permission) => permission === "core:provider:read"),
    [items[0]],
  );
});

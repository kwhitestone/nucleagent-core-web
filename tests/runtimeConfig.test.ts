import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runtimeFixture } from "./fixtures/runtimeConfig.ts";

const nginxTemplate = readFileSync(new URL("../nginx.conf.template", import.meta.url));
const runtimeHook = readFileSync(new URL("../docker-entrypoint.d/40-runtime-config.sh", import.meta.url), "utf8");

function render(overrides: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "core-web-csp-"));
  const template = join(directory, "template");
  const output = join(directory, "output");
  try {
    writeFileSync(template, nginxTemplate);
    const script = runtimeHook
      .replace("/etc/nginx/runtime.conf.template", template)
      .replace("/etc/nginx/conf.d/default.conf", output)
      .replaceAll("/etc/nucleagent", directory);
    const result = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, CORE_UPSTREAM: "https://api.example.test",
        SHELL_ORIGIN: "https://shell.example.test", ...runtimeFixture(), ...overrides },
    });
    return { status: result.status, stderr: result.stderr,
      config: result.status === 0 ? readFileSync(output, "utf8") : "",
      runtime: result.status === 0 ? JSON.parse(readFileSync(join(directory, "runtime-config.json"), "utf8")) : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("custom template is outside the base image automatic envsubst directory", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /^COPY nginx\.conf\.template \/etc\/nginx\/runtime\.conf\.template$/m);
  assert.doesNotMatch(dockerfile, /^COPY .* \/etc\/nginx\/templates\//m);
});

test("startup injects only public runtime keys, never process credentials", () => {
  const result = render({ SECRET: "private-fixture", VITE_SECRET: "private-fixture" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.runtime, runtimeFixture());
  assert.doesNotMatch(JSON.stringify(result), /private-fixture/);
  assert.match(result.config, /location = \/runtime-config\.json/);
  for (const value of ["", 'https://user:password@example.test', 'https://example.test";exit', "https://example.test\n"]) {
    const rejected = render({ VITE_STORAGE_URL: value });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /VITE_STORAGE_URL/);
    assert.doesNotMatch(rejected.stderr, /password|exit/);
  }
});

test("runtime CSP defaults to the shell and preserves nginx variables", () => {
  const result = render({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.config, /frame-ancestors https:\/\/shell\.example\.test"/);
  assert.match(result.config, /proxy_set_header Host \$proxy_host/);
  assert.match(result.config, /try_files \$uri \$uri\/ \/index.html/);
});

test("startup serializes only an explicitly valid optional shell allowlist", () => {
  const value = "https://shell.example.test,http://tauri.localhost,https://localhost";
  assert.equal(render({ VITE_SHELL_ALLOWED_ORIGINS: value }).runtime.VITE_SHELL_ALLOWED_ORIGINS, value);
  assert.equal(render({}).runtime.VITE_SHELL_ALLOWED_ORIGINS, "");
  for (const value of ["*", "http://localhost,", ",http://localhost", "http://user:pass@localhost", "http://localhost:0"]) {
    assert.notEqual(render({ VITE_SHELL_ALLOWED_ORIGINS: value }).status, 0);
  }
});

test("runtime CSP accepts an exact configurable shell and engine origin list", () => {
  const result = render({ FRAME_ANCESTORS: "https://shell.example.test,https://engine.example.test:8443" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.config, /frame-ancestors https:\/\/shell\.example\.test https:\/\/engine\.example\.test:8443"/);
});

test("API streams disable buffering and retain the downstream ingress hint", () => {
  const result = render({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.config, /map \$upstream_http_content_type \$sse_buffering/);
  assert.match(result.config, /location \/api\/ \{[^}]*proxy_buffering off;/);
  assert.match(result.config, /location \/api\/ \{[^}]*proxy_cache off;/);
  assert.match(result.config, /add_header X-Accel-Buffering \$sse_buffering always;/);
});

for (const [index, value] of ["", ",", "https://shell.example.test,", ",https://shell.example.test",
    "https://shell.example.test,,https://engine.example.test", "*", "'self'",
    "https://*.example.test", "https://user:pass@example.test", "https://example.test/path",
    "https://example.test?query", "https://example.test#fragment", "https://example.test:0",
    "https://example.test:65536", "https://example.test https://engine.example.test",
    "https://example.test,\nhttps://engine.example.test", 'https://example.test"; include /tmp/evil; #'].entries()) {
  test(`runtime CSP rejects unsafe frame origin case ${index}`, () => {
    const result = render({ FRAME_ANCESTORS: value });
    assert.notEqual(result.status, 0, JSON.stringify(value));
    assert.match(result.stderr, /FRAME_ANCESTORS/);
  });
}

test("runtime rejects credentialed upstream and shell paths", () => {
  assert.notEqual(render({ CORE_UPSTREAM: "https://user:pass@example.test" }).status, 0);
  assert.notEqual(render({ SHELL_ORIGIN: "https://example.test/path" }).status, 0);
});

test("upstream Cache-Control passes through; everything else stays no-cache", () => {
  const result = render({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.config, /map \$upstream_http_cache_control \$default_cache_control \{\s*"" "no-cache";\s*default "";\s*\}/);
  assert.match(result.config, /add_header Cache-Control \$default_cache_control always;/);
  assert.doesNotMatch(result.config, /add_header Cache-Control "no-cache"/);
});

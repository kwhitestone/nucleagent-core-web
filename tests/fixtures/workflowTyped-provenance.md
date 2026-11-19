# Saved schema provenance

`engine6792-input.json` is the exact parsed inputSchema from Core's saved
`app/src/server/addons/agentiaimport/testdata/engine_job_6792.json` at
v0.1.54 (`110b78b281393bfae65066f1317bd21364558cb7`). The source uses the literal
`video-model`; no live model mapping, price, default or resolution is inferred.

`core-job-scalars.json` is the parsed JSON declaration in
`internal/mcpprobe/job_scalar_test.go`, TestJobScalarParametersBindWithEnumAndBounds,
at the same Core commit. Boolean and number coverage comes from this saved Core
contract, not an invented capability of the video model.

`workflowTyped.ts` selects the four real engine field declarations for an isolated
closed caller-contract test. Tool ID and revision are test metadata. This is NOT a
saved live /schema response or an assertion about current JobCallerSchema projection:
that projection also excludes fixed start arguments. Nullable/array fields remain
unsupported by this minimal form and fail closed when required. The fixture image
string tests scalar validation only; it is not a verified image source. WorkflowForm
cannot supply required image_url until controlled-source integration is implemented.

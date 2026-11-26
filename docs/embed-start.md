# Optional embedded conversation start

The host handshake remains disabled when `VITE_EMBED_HOST_ORIGINS` is empty.
Only the parent frame at an explicitly allowed origin can send messages.
Direct visits and the shell SSO channel keep their existing behavior.

After `agentia:embed-init` and a successful `nucleagent:credential-ack`, the
same host can send:

```json
{"type":"agentia:embed-start","payload":{"conversationId":"task-123","input":"Hello","gen":"image"}}
```

`conversationId` must exactly match the initialized ID, use the `task-` prefix
with an ASCII alphanumeric, underscore or hyphen suffix, and fit within 200
characters. `input` must contain non-whitespace text and be at most 2,000 Unicode
code points, including whitespace. `gen` is optional and accepts only `image`
or `video`. Text uses the current user's ordinary `a2a_agent` creation flow.
Media uses the existing home generation flow and its default model selection
(first verified model, otherwise first model), with default generation parameters.
The host's explicit media submission authorizes that initial generation; it does
not modify the standalone home page's video confirmation preference.

One valid start is accepted per frame lifetime, including concurrent starts and
failed creation attempts. Invalid messages, mismatched IDs, pre-ack starts and
repeated starts receive no response. Re-initialization does not reset this limit.
Revocation invalidates pending authentication and cancels pending startup/model
loading; an already submitted server request cannot be undone by this protocol.

Successful creation and navigation to `/c/<id>` replies:

```json
{"type":"nucleagent:conversation-created","payload":{"conversationId":"task-123","createdConversationId":"42"}}
```

Failure replies with the sole public error enum `START_FAILED`:

```json
{"type":"nucleagent:start-failed","payload":{"conversationId":"task-123","code":"START_FAILED"}}
```

The failure includes no prompt, credential or backend exception. It does not
prove that a server-side submission failed: reconcile before starting a new
frame after an uncertain result. Revoked or replaced handshakes receive no stale
completion response. There is no cross-frame idempotency guarantee; hosts must
persist the returned conversation ID and reopen that conversation on refresh.

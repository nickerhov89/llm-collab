# Native Codex history through the Polza OpenRouter bridge

The bridge translates replay records at the HTTP boundary. It does not edit a
rollout, replace an existing chat, or change a manually selected model.

- Native `additional_tools` is historical context, not a grant of live tools.
  Preserve its complete JSON as an assistant context message. Keep the actual
  request's `tools` unchanged.
- Public `reasoning_text` in messages becomes ordinary text of the same role.
- Reasoning output with public `content: reasoning_text[]` is not accepted as
  Responses input. Move that text into `summary_text[]`, retaining existing
  summaries, IDs and opaque encrypted fields. This also handles tool-result
  continuation after models that return this shape themselves.
- Calls, results, opaque compaction/reasoning records and images remain intact.
  A final developer note names only the current tools.
- For legacy histories only, a streamed Responses `function_call` named `exec`
  with exactly `{cmd: string}` is equivalent to the currently declared
  `exec_command` function. Normalize that output name only after the complete
  arguments validate. Custom JavaScript, extra arguments and other tools are
  never aliased. This grants no tool: the native CLI still applies its usual
  approvals and sandbox. If `exec` is already offered, no alias is enabled.
  Tool events are held only until their arguments finish, with a bounded buffer;
  ordinary text keeps streaming. JSON responses use the same narrow alias.
- Responses requests without an explicit output limit use 8192 tokens in the
  deployed bridge (`POLZA_OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS`). Explicit limits
  are preserved. This bounds reservation when the native CLI omits the field;
  a low account balance can still cause 402.
- Await the upstream-to-client stream pipeline. A late upstream disconnect must
  end that request without an unhandled Readable error killing every other chat.
  Never append JSON to an already-started SSE response.

For explicit Polza Codex gateway launches, provide a launch-scoped native
`model_catalog_json`. Context length and vision capabilities come from the local
bridge's account catalog; reasoning levels come from the existing effort metadata.
The canonical Codex local-model instructions are retained with attribution in
`third_party/codex-local-prompt`. Native CLI config and transcript metadata are
not rewritten. Temporary catalogs are private and released with the launch lease.
The mechanism was exercised against deployed Codex 0.167.0; this is not a claim
that the entire provider adapter has been upgraded from its declared 0.164.0
compatibility target.

## Synthetic live audit

These commands make paid, bounded synthetic calls to every advertised agent model.
Run them deliberately, not as part of CI. Three workers, 45/60 second deadlines,
128/512 output-token budgets. No user history, real tools, files or external actions.
The second phase sends a generated red PNG only to advertised image-capable models,
checks streamed tool arguments and then checks a tool-result continuation, preserving returned public/encrypted reasoning
blocks. Responses
also includes synthetic legacy history to exercise the translation above.

```sh
export POLZA_MODEL_AUDIT_DIR="$HOME/.local/state/polza-model-audit/DATE"
node scripts/polza-model-matrix.mjs
node scripts/polza-model-matrix-tools.mjs
```

The first script uses the existing private operator key only for the account
catalog; inference uses the local bridge. Both phases persist per-model/API NDJSON
and progress. Resume skips recorded cases. To repeat a case, archive the previous
result and remove only that case from the active result set. Do not mix snapshots
from different catalogs.

HTTP 200 alone is not success: terminal SSE, expected content, tool JSON, image
value and continuation are checked. A missing answer at the small output budget
is inconclusive for model quality. Provider Terms refusals, retired IDs, rate
limits and unsupported upstream input remain explicit failures; do not bypass
restrictions or claim all advertised models are usable. The tool/image phase skips
base 403/404 cases and labels them as skipped, not passed.

Deployment note: the packaged runtime rewrites the shared-library import to
`../../../bundled/@yep-anywhere/shared/dist/index.js`. A raw `transpileModule`
output must preserve that packaging rewrite. Verify an actual module import under
the service UID before restarting an idle backend.

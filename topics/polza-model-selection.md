# Polza model selection

In an existing chat, the Polza model menu offers Auto and the active
process provider's model catalog. Choosing a model applies process config
without navigating to a new-session composer. There is no cross-provider
new-chat launcher in this menu.

OpenRouter (codex-oss) remains available in new-chat provider selection.
An existing OpenRouter chat can select models from its own process catalog.
Selecting OpenRouter from a different provider's chat is not an in-place
provider migration and must not silently create another chat.

## Live verification, 2026-11-12

The old deployed picker was reproduced redirecting an existing Claude chat
to the new-session composer with provider=codex-oss and separateProjectDraft=1.
The published fix was then applied as a narrow patch to the two server client
source files, preserving the dirty checkout, and deployed with the existing
client deployment script after TypeScript/Vite and its HTTP check succeeded.

On the new live bundle the full loaded in-chat menu has no cross-provider
new-chat section or OpenRouter button. Selecting the existing Claude model
returned a successful switch notification and retained the same session URL.
Auto was restored, and the test provider was reaped after a native model-control
turn remained active (see the adjacent gap). The final menu was checked on
desktop; viewport overrides did not change the inspected tab's measured size,
so this run does not establish a phone-layout check.

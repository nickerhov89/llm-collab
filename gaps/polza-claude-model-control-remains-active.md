# A Claude model-control turn can remain active after selection succeeds

During live verification of the in-chat model picker, model configuration
returned a successful switch notification and retained the original session URL.
The provider then displayed native /model control records while remaining in-turn
with no new output. A graceful Stop did not clear the state during the observed
interval; restarting that single provider restored the idle chat. Haiku and
Auto were restored after the test. No user task was submitted by the test.

The root cause is unconfirmed. Investigate ModelSwitchModal.selectQuickModel,
setProcessConfig and the Claude adapter's native model-control completion path;
a model-control acknowledgement should not leave the conversation looking like
a running user task. Also inspect click stability while the bottom-anchored
quick menu grows from Loading models into its catalog: a rapid attempted Auto
selection selected a lower model row during this run, whereas waiting for the
loaded catalog allowed Auto to be selected correctly. This may be a layout/input
race and needs a focused reproduction before assigning a cause.

This is separate from the cross-provider new-chat launcher, which was removed
and verified on the published client. It was not expanded into a provider
runtime fix during that bounded navigation correction.

Found 2026-11-12 while verifying the Polza OpenRouter menu correction live.

# Editorial quality: examples, not a leaderboard

The [25 synthetic cases](editorial-cases.json) contrast a useful, faithful rewrite (`good`) with an unacceptable one (`bad`). They contain no private conversations and cover exploration, scope exclusions, uncertainty, profanity, explicit brevity, literals, code, multilingual voice, user corrections, assistant proposals, hostile context, summaries, historical tool evidence, and no-op success. Five Strong-specific contrasts also cover rough repairs, conditional commits, contextual ideas, length limits, and uncertain exploration.

The good examples are **illustrations, not exact-match golden outputs**. Cases marked `intensity: "strong"` illustrate enrichment, not the expected behavior of Light. For a rough task at Strong, punctuation-only editing can be a quality failure even when faithful. Conversely, an already-effective prompt may stay unchanged at every intensity.

## Runnable coverage

Run `npm test` in either runtime checkout. `test/editorial.test.ts` checks that all 25 original drafts reach request construction intact at every intensity and that the illustrative rewrites preserve declared literal spans. The context/provider/workflow regressions separately exercise user-constraint selection, source exclusion, tool opt-in, revision framing, cancellation, candidate recovery, and replacement safety.

Those tests establish deterministic behavior. They do **not** establish that a real model obeys the editing instruction. A canned provider cannot measure voice or intent fidelity.

## Human review of real outputs

Before changing the instruction, selection policy, or default model:

1. Use a disposable session containing only a case's synthetic material. Keep the roles described by `context`: an assistant proposal must not be presented as a user decision. For standalone cases use `none`; for contextual cases inspect the actual supplied sources. Select tool evidence explicitly for the historical-result case.
2. Run the draft through light, standard, and strong intensity. Light cleans up; Standard clarifies and organizes; Strong develops rough ideas with task-appropriate supporting detail. Compare against both the `good` and `bad` examples, respecting Strong-only labels. For instruction changes, compare real outputs before and after with the same model and supplied evidence.
3. Record model/provider, intensity, selected source IDs, and whether each criterion below passes. Keep any captures outside the repository unless they contain only synthetic material and are intentionally contributed. Never collect private prompts or feedback as automatic telemetry.
4. Review failures manually. A model judge may help triage, but cannot certify user intent or whether something sounds like the user.

| Criterion | Pass condition |
|---|---|
| Scope | Same underlying goal and request type; supporting detail helps that goal, all exclusions and conditions survive. |
| Request type | Questions/exploration do not become decisions or implementation. |
| Certainty | Possibilities stay possibilities; observations do not become diagnoses. |
| Authority | Current draft and explicit user corrections win over proposals/summaries. |
| Voice | Language, warmth, profanity, humor, and register remain recognizable. |
| Usefulness | Strong adds substantive help to rough ideas, not just rephrasing; already-complete requests need not grow. |
| Proportion | Expansion fits the task and explicit length limits; no boilerplate or gratuitous process. |
| Literals | Names, commands, URLs, strings, and code remain exact unless change was requested. |
| Evidence | Added facts have direct support; sensible proposed steps are not presented as observed facts. |

Supporting investigation, relevant edge cases, and focused verification can strengthen an existing repair request. Comparison criteria can strengthen exploration. Neither requires inventing facts or creating independent deliverables. A genuinely different goal, lost hard constraint, invented fact/decision, or changed literal is a failure, not a tradeoff against nicer wording. Track whether human editing was still needed; character growth alone is not a quality score.

## Small real-model comparison

On 2026-09-04, a disposable native Pi 0.85.0 check used the configured `openai-codex/gpt-6-astra` model through Chisel's actual provider boundary, with its normal minimal-reasoning setting. It made **14 requests**, using only synthetic drafts and explicit synthetic dialogue—no private session, workspace evidence, or tools.

Three Strong cases were compared with the previous conservative instruction and the new enrichment instruction, keeping their request inputs and model fixed:

| Draft | Before | After |
|---|---|---|
| `fix the login bug` | Returned unchanged. | Added focused investigation, reproduction, a targeted fix, verification, and a short completion summary; no invented cause. |
| `where are we at? maybe commit if it makes sense` | Capitalization and punctuation only. | Added status/verification/open-work detail while keeping the commit conditional, excluding unrelated work, and not authorizing push. |
| Local CLI search idea, “no code yet” | Resolved the referent and local-only constraint. | Also added matching/ranking, interaction, and scale tradeoffs; retained local-only exploration and no-code boundaries. |

Six further Strong outputs retained the tested one-sentence limit, uncertainty, narrow typo-only scope, profanity/discussion, exact command/path, and no-edit constraint. An already-developed table request was expanded slightly rather than returned unchanged; no-op remains supported, not guaranteed. Light only cleaned up the login draft; Standard added a short clarification rather than Strong's fuller treatment.

These are **agent-reviewed observations from one run**, not an independent human evaluation, statistical benchmark, or promise of behavior across providers. The login example is also present in the instruction, so it is not a held-out test. Use the rubric above for broader evaluation, including repeated runs and unseen drafts.

## Known ceilings

Selection uses lexical matching, recency, user-turn relationships, and English constraint cues rather than semantic retrieval. Implicit or multilingual references can be missed; long indivisible sentences can be omitted when they cannot fit. The inspector makes the supplied excerpts visible, but source inclusion is not verification. Human review remains the final boundary.

---
paths:
  - src/lib/gemini.ts
  - src/lib/receipt-scan.ts
  - src/lib/ai-assessment.ts
  - src/lib/gemini-limits.ts
  - "src/app/api/receipts/**"
  - src/lib/telegram/classify.ts
---

# Gemini

## Environment Variables

- `GEMINI_MODEL` — Optional; Gemini model for **every** AI call (receipt scanning, itemization, AI Assessment, Telegram classification). Defaults to `gemini-3.6-flash`. Import it from `src/lib/gemini.ts`; never write a model id at a call site — the Telegram classifier pinned a literal and silently ran two generations behind (#163)
- `GEMINI_FALLBACK_MODEL` — Optional; model retried once when the primary stays overloaded (503) after retries (defaults to `gemini-3.5-flash`, a generation behind the primary on purpose; `""` disables fallback)
- `GEMINI_THINKING_BUDGET` — Optional; thinking budget for **Gemini 2.x** models. `-1` = dynamic thinking (default, best quality), `0` = off (speed mode), `128`-`24576` = fixed token budget
- `GEMINI_THINKING_LEVEL` — Optional; thinking level for **Gemini 3+** models (they use `thinkingLevel`, not `thinkingBudget`): `minimal` (speed mode) | `low` | `medium` (default, best quality) | `high`. This is the knob that applies by default, since the default model is now 3.x. It governs receipt scanning and AI Assessment only: the Telegram classifier is pinned to minimal via `classifyConfig()` and deliberately ignores it, because the two want opposite things and one variable cannot say both
- `GEMINI_TIMEOUT_MS` — Optional; per-attempt request timeout in ms (default `60000`, `0` disables). Timed-out attempts are retried like 503s. Lower it (e.g. `30000`) when running speed mode

# Spanish risk keywords in the execution router

## Objective
Make the local risk signal (`classifyTask().risk`) detect Spanish
authentication, payment/billing, and recovery-credential terms, so Spanish
tasks get the same effort tier and approval gate as their English equivalents.

## Problem
`RISK_KEYWORDS` in `src/global/intelligence/execution-router.js` are English
substrings. Found during the Jev shadow pilot (feature jev-shadow-comparison,
T12): "autenticación" does not contain "auth", "facturación" is not
"billing", and "código de recuperación" matches nothing. Spanish risky tasks
drop to light/standard and skip WAIT_FOR_APPROVAL. Baseline on main
(b3e2725): "Refactor the authentication flow" -> risk [auth, authentication]
(approval); "Refactoriza el flujo de autenticación" -> risk [] (auto-routed).
"secreto" is only detected by accident (substring of "secret").

## Scope
- Add a bounded Spanish risk list: authentication/authorization,
  payments/billing, passwords/credentials/recovery codes.
- Match Spanish terms accent-insensitively and only at the start of a word,
  so "pago" never fires inside "apagó"/"apago".
- English matching stays byte-for-byte unchanged.

Out of scope: Spanish reasoning/multi-file keywords, generic verbs like
"borrar" (false-positive risk), semantic detection, Jev.

## Acceptance criteria
- es-heavy-1, es-heavy-3, and the Spanish recovery-code case classify heavy.
- Accented and unaccented variants behave the same.
- Innocuous phrases ("se apagó", "paginación", "página", "cobertura") stay risk-free.
- A Spanish risk + reasoning task reaches WAIT_FOR_APPROVAL like its English twin.
- Existing English profiles are unchanged.

## TDD
Mode: off (no explicit project/session config). Runner: `node --test`.
Tests are written first anyway (RED observed before the classifier edit).

## Delivery
Branch: fix/spanish-risk-keywords (from main). Single small PR. RDD: off.

## Tasks
- [x] S1 — RED tests in test/execution-router.test.js: positives, accent
  parity, and approval parity failed on main as expected (3/5); negatives
  and English-unchanged passed (regression guards).
- [x] S2 — `SPANISH_RISK_KEYWORDS` matched at word start on accent-folded
  text; English list untouched. GREEN: router tests 43/43, full suite
  2142 pass / 0 fail / 1 skipped.
  Self-found bug while implementing: the first `foldAccents` truncated
  astral characters (emoji) to one UTF-16 unit, shifting Spanish match
  indexes and misordering them against English matches. Regression test
  (12 emoji before "production pago") failed first, then passed with
  length-preserving folding.

## Known follow-ups (out of scope)
- English list has no "recovery code"; en-contrast-heavy-2 stays standard.
- Spanish reasoning/multi-file keywords are still missing ("integra" is not
  "integrate"), so es-heavy-3 is heavy only via "facturación".
- Merging this into feat/jev-shadow-comparison will break its contrast-set
  control test: es-contrast-heavy-2 now hits "codigo de recuperacion", so
  local no longer answers standard for all 8 contrast cases.

## Next step
User decides push/PR.

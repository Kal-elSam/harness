// Pure classification of provider failure output. No probes, writes or retries.
export function detectExhaustion(resultText, exitInfo = {}) {
  if (typeof resultText !== 'string' || !resultText.trim()) return null;
  const fallback = resultText.match(/^fallback:[^\r\n]*/im)?.[0];
  const matches = resultText.matchAll(/(?:you(?:'ve| have)? (?:hit|reached|exceeded) (?:your |the )?(?:current )?(?:usage |rate )?(?:limit|quota)|(?:usage|rate)[ _-]?limit[ _-]?(?:reached|exceeded|error)|(?:error[: ]+|429[: ]+)(?:usage|rate)[ _-]?limit|(?:insufficient|exceeded|exhausted)[ _-]quota|(?:quota|limit) (?:has been )?(?:exceeded|exhausted|reached))[^\r\n]*/gi);
  // Runtime diagnostics start a line, follow a provider/error label, or live
  // inside an error object. Literal codes embedded in implementation summaries
  // are not evidence of exhaustion, regardless of the process exit code.
  const limit = [...matches].find(match => {
    const prefix = resultText.slice(0, match.index).split(/\r?\n/).at(-1).trim();
    return /^(?:\[(?:error|warn|warning)\]\s*)?(?:(?:claude|codex|openai|anthropic|error(?: code)?|429)\b[\s:=-]*)*$/i.test(prefix)
      || /["']error["']\s*:/.test(prefix);
  })?.[0];
  // Plain mentions of limits in implementation prose are not failures.
  if (!fallback && !limit) return null;
  const provider = exitInfo.provider ?? exitInfo.adapterId
    ?? (/codex|openai/i.test(fallback ?? resultText) ? 'codex' : /claude|anthropic/i.test(fallback ?? resultText) ? 'claude' : null);
  if (!provider) return null;
  return { provider, reason: (fallback ?? limit).trim() };
}

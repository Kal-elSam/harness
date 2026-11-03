/** Typed, side-effect-free delegation validation errors. */
export class DelegationContractError extends TypeError {
  constructor(code, field, message) {
    super(message);
    this.name = 'DelegationContractError';
    this.code = code;
    this.field = field;
  }
}

const text = value => typeof value === 'string' && value.trim().length > 0;
const texts = (value, empty = false) => Array.isArray(value) && (empty || value.length > 0) && value.every(text);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireField(valid, code, field) {
  if (!valid) throw new DelegationContractError(code, field, `Invalid delegation field: ${field}`);
}

/** Return the original handoff; validation never mutates or grants authority. */
export function validateDelegationHandoff(value) {
  const code = 'invalid_handoff';
  requireField(object(value), code, 'handoff');
  for (const field of ['goal', 'authorizedFiles', 'preservedContracts', 'decisionsTaken', 'acceptanceChecks', 'workBudget', 'escalationCondition']) {
    const list = ['authorizedFiles', 'preservedContracts', 'decisionsTaken', 'acceptanceChecks'].includes(field);
    requireField(list ? texts(value[field], field === 'decisionsTaken') : text(value[field]), code, field);
  }
  requireField(value.authorizedFiles.every(path => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') && !['.', '**', '**/*', '*'].includes(path) && !path.split('/').includes('.')
    // Reject surfaces that widen: leading wildcards, directories, recursive globs, home and drive paths.
    && !/^[*?[{~]/.test(path) && !path.endsWith('/') && !path.includes('**') && !path.split('/').includes('*') && !/^[A-Za-z]:/.test(path)), code, 'authorizedFiles');
  if (Object.hasOwn(value, 'testBudget')) validateTestBudget(value.testBudget, code);
  return value;
}

/** A no-change result may have an empty diff and blockers, but needs evidence. */
export function validateWorkerResult(value, handoff) {
  const code = 'invalid_worker_result';
  requireField(object(value), code, 'result');
  requireField(typeof value.diff === 'string', code, 'diff');
  requireField(texts(value.evidence), code, 'evidence');
  requireField(texts(value.blockers, true), code, 'blockers');
  if (handoff !== undefined) validateDelegationHandoff(handoff);
  if (handoff?.testBudget !== undefined || Object.hasOwn(value, 'testsRun')) {
    requireField(object(value.testsRun), code, 'testsRun');
    for (const field of ['focused', 'affected']) requireField(texts(value.testsRun[field], true), code, `testsRun.${field}`);
    requireField(typeof value.testsRun.fullSuite === 'boolean', code, 'testsRun.fullSuite');
    requireField(!(handoff?.testBudget?.fullSuite === 'never' && value.testsRun.fullSuite), code, 'testsRun.fullSuite');
  }
  // A worker cannot approve its own result.
  requireField(!Object.hasOwn(value, 'approved'), code, 'approved');
  return value;
}

function validateTestBudget(value, code) {
  requireField(object(value), code, 'testBudget');
  for (const field of ['focused', 'affected']) requireField(texts(value[field], true), code, `testBudget.${field}`);
  requireField(['never', 'once-per-slice'].includes(value.fullSuite), code, 'testBudget.fullSuite');
}

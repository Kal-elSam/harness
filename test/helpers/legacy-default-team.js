// Pre-v2 default team (S4 flipped the registry default to the v2 roles). Selection-engine
// tests pin this set so they keep exercising their mechanics on a fixed role list.
import { ROLE_REGISTRY } from '../../src/global/intelligence/role-registry.js';

export const LEGACY_DEFAULT_ROLES = Object.freeze(['Explorer', 'Architect', 'Builder', 'Debugger (fix)', 'Test Runner', 'Reviewer', 'Debugger (diagnosis)', 'Test Designer']);
export const LEGACY_DEFAULT_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(LEGACY_DEFAULT_ROLES.map(role => [role, ROLE_REGISTRY[role].capabilities])));

// Same eight-role shape with the Architect seat renamed to its v2 id: for fixtures that assert assessment/project raises, which only apply to Technical Lead now.
export const PINNED_TEAM_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(LEGACY_DEFAULT_ROLES.map(role => [role === 'Architect' ? 'Technical Lead' : role, ROLE_REGISTRY[role === 'Architect' ? 'Technical Lead' : role].capabilities])));

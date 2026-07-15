import {
  BACKEND_IDS,
  COST_CLASSES,
  PRIVACY_CLASSES,
  TRANSPORT_KINDS,
  createModelDescriptor
} from "../types.js";
import {
  listRegisteredModelIds,
  normalizeModelId,
  resolveRuntimeProduct,
  toRuntimeModelRef
} from "../transport-registry.js";
import { CAPABILITY_STATES } from "../../capability-states.js";
import { isExecutableAvailable } from "../../cli-probe.js";
import { parseOpencodeJsonEvents, runOpencodeJson } from "./opencode-cli.js";
import {
  BILLING_MODELS,
  ENTITLEMENT_STATES,
  collectOpencodeCliEvidence
} from "./opencode-evidence.js";

const PREAMBLE =
  "Answer with analysis only. Do not modify files, run mutating tools, or change the workspace.";

/** Non-mutating OpenCode CLI runtime. Override-only; never auto-routed; never reads auth.json. */
export function createOpencodeRuntimeBackend({
  env = process.env,
  spawnImpl,
  whichImpl = isExecutableAvailable,
  collectCliEvidence = collectOpencodeCliEvidence
} = {}) {
  return {
    id: BACKEND_IDS.OPENCODE,
    label: "OpenCode CLI",
    local: false,

    async detect() {
      const cli = collectCliEvidence({ env, whichImpl });
      if (!cli.cliInstalled) {
        return baseDetect({
          state: CAPABILITY_STATES.UNKNOWN,
          detected: false,
          available: false,
          configured: false,
          entitlement: ENTITLEMENT_STATES.UNKNOWN,
          evidence: {
            hasApiKey: false,
            cliInstalled: false,
            authListOk: false,
            authProviders: [],
            modelsHttpStatus: null
          },
          recommendation:
            "Install and authenticate the OpenCode CLI to use Anthropic/Google models via runtime transport (Kairo does not read OpenCode auth files)."
        });
      }

      const configured = cli.authProviders.length > 0;
      return baseDetect({
        state: CAPABILITY_STATES.DETECTED,
        detected: true,
        available: true,
        configured,
        entitlement: configured
          ? ENTITLEMENT_STATES.UNVERIFIED
          : ENTITLEMENT_STATES.UNKNOWN,
        evidence: {
          hasApiKey: false,
          cliInstalled: true,
          authListOk: cli.authListOk,
          authProviders: cli.authProviders,
          modelsHttpStatus: null
        },
        error: cli.error,
        recommendation: configured
          ? `OpenCode CLI configured providers: ${cli.authProviders.join(", ")}. Entitlement remains ${ENTITLEMENT_STATES.UNVERIFIED}. Runtime invoke needs --cloud-consent --yes.`
          : "OpenCode CLI detected but auth list reported no providers. Run `opencode auth login` (Kairo never reads auth.json)."
      });
    },

    async listModels() {
      const models = listRegisteredModelIds("zen", { runtimeOnly: true })
        .map((modelId) => runtimeModel("zen", modelId));
      for (const modelId of listRegisteredModelIds("go", { runtimeOnly: true })) {
        if (models.some((entry) => normalizeModelId(entry.modelId) === modelId)) continue;
        models.push(runtimeModel("go", modelId));
      }
      return models;
    },

    async capabilities() {
      const d = await this.detect();
      return {
        id: BACKEND_IDS.OPENCODE,
        local: false,
        cloud: true,
        requiresApiKey: false,
        requiresConsent: true,
        streaming: false,
        tools: false,
        runtime: true,
        transports: [TRANSPORT_KINDS.RUNTIME],
        billingModel: d.billingModel,
        entitlement: d.entitlement,
        configured: d.configured,
        authenticated: false,
        state: d.state,
        hasApiKey: false,
        mutating: false
      };
    },

    async invoke(contextPack, request = {}) {
      const detection = await this.detect();
      if (!detection.available) return fail(detection.recommendation);

      const modelRef = resolveModelRef(request.modelId);
      if (!modelRef) {
        return fail(
          "Runtime invoke requires --model <provider/model> (e.g. opencode/claude-haiku-4-5)."
        );
      }

      const timeoutMs = request.timeoutMs ?? 120_000;
      try {
        const { stdout, stderr, status, timedOut } = await runOpencodeJson({
          modelRef,
          prompt: buildPrompt(contextPack, request),
          cwd: request.cwd ?? contextPack?.workspaceRoot ?? process.cwd(),
          env,
          spawnImpl,
          timeoutMs
        });
        if (timedOut) return fail(`OpenCode CLI timed out after ${timeoutMs}ms.`);

        const parsed = parseOpencodeJsonEvents(stdout);
        if (parsed.error) return fail(parsed.error);
        if (!parsed.content) {
          const detail = stderr?.trim() || (status == null ? "no content" : `exit ${status}`);
          return fail(`OpenCode CLI produced no text output (${detail}).`);
        }

        return {
          ok: true,
          backendId: BACKEND_IDS.OPENCODE,
          model: modelRef,
          content: parsed.content,
          usage: {
            ...parsed.usage,
            model: modelRef,
            backendId: BACKEND_IDS.OPENCODE,
            fallbackUsed: false
          },
          raw: { events: parsed.events, status }
        };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return fail(
            "OpenCode CLI is not installed. Install OpenCode, authenticate it, then retry with --backend opencode."
          );
        }
        return fail(error?.message ?? String(error));
      }
    }
  };
}

function baseDetect(fields) {
  return {
    id: BACKEND_IDS.OPENCODE,
    label: "OpenCode CLI",
    hasApiKey: false,
    cloud: true,
    runtime: true,
    authenticated: false,
    billingModel: BILLING_MODELS.CLI_RUNTIME,
    error: null,
    ...fields
  };
}

function runtimeModel(product, modelId) {
  return createModelDescriptor({
    provider: BACKEND_IDS.OPENCODE,
    modelId: toRuntimeModelRef(product, modelId),
    local: false,
    costClass: COST_CLASSES.PAID,
    privacyClass: PRIVACY_CLASSES.CLOUD,
    transport: TRANSPORT_KINDS.RUNTIME
  });
}

function resolveModelRef(modelId) {
  if (!modelId) return null;
  const raw = String(modelId).trim();
  if (raw.includes("/")) return raw;
  const product = resolveRuntimeProduct(raw);
  return product ? toRuntimeModelRef(product, raw) : null;
}

function buildPrompt(contextPack, request) {
  const chunks = [PREAMBLE];
  if (contextPack?.systemPrompt) chunks.push(contextPack.systemPrompt);
  if (request.prompt) chunks.push(request.prompt);
  else if (Array.isArray(request.messages)) {
    for (const message of request.messages) {
      if (message?.content) chunks.push(String(message.content));
    }
  }
  return chunks.join("\n\n");
}

function fail(message) {
  return {
    ok: false,
    backendId: BACKEND_IDS.OPENCODE,
    model: null,
    content: null,
    error: message,
    usage: null
  };
}

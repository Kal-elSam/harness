#!/bin/bash
set -e

echo "Creating agent compatibility links..."

mkdir -p .claude
if [ ! -e CLAUDE.md ]; then
  ln -s AGENTS.md CLAUDE.md
  echo "✓ CLAUDE.md -> AGENTS.md"
fi

if [ ! -e .claude/CLAUDE.md ]; then
  ln -s ../AGENTS.md .claude/CLAUDE.md
  echo "✓ .claude/CLAUDE.md -> ../AGENTS.md"
fi

if [ ! -e .windsurfrules ]; then
  ln -s AGENTS.md .windsurfrules
  echo "✓ .windsurfrules -> AGENTS.md"
fi

mkdir -p .agent
if [ ! -e .agent/AGENTS.md ]; then
  ln -s ../AGENTS.md .agent/AGENTS.md
  echo "✓ .agent/AGENTS.md -> ../AGENTS.md"
fi

mkdir -p .github
if [ ! -e .github/copilot-instructions.md ]; then
  cat > .github/copilot-instructions.md <<'EOF'
Este archivo es un puntero de compatibilidad.
Fuente universal: `../AGENTS.md`.
Fuente técnica: `../docs/ai/`.
Skills operativos: `../docs/skills/`.
EOF
  echo "✓ .github/copilot-instructions.md"
fi

echo "Done. AGENTS.md is the universal source of truth."

# Gemini
if [ ! -e GEMINI.md ]; then
  ln -s AGENTS.md GEMINI.md
  echo "✓ GEMINI.md -> AGENTS.md"
fi

# Codex folder
mkdir -p .codex

# Gentle AI folder
mkdir -p .gentle-ai

# Universal parity note
echo "Adapter parity: AGENTS.md is governance-primary. Adapters are translation layers."

# Runtime Observability

## Eventos mínimos

```txt
agent_run_started
agent_run_finished
loop_started
loop_iteration
loop_escalated
loop_stopped
quality_gate_failed
quality_gate_passed
eval_run_finished
human_approval_required
rollback_created
rollback_executed
```

## Campos mínimos

```txt
run_id
timestamp
adapter
agent
model
task
spec
files_changed
commands_run
tests_run
evals_run
token_estimate
cost_estimate
status
risk_level
approval_status
```

## Archivos locales

```txt
.harness/logs/runs.jsonl
.harness/logs/evals.jsonl
.harness/logs/quality-gates.jsonl
.harness/logs/approvals.jsonl
```

export function isProcessAlive(pid) {
  if (pid == null || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

export async function isRunAlive(homeDir, run, { readSupervisorLockImpl } = {}) {
  if (run.pid && isProcessAlive(run.pid)) {
    return true;
  }

  if (readSupervisorLockImpl) {
    const lock = await readSupervisorLockImpl(homeDir, run.runId);
    if (lock?.agentPid && isProcessAlive(lock.agentPid)) {
      return true;
    }
    if (lock?.supervisorPid && isProcessAlive(lock.supervisorPid)) {
      return true;
    }
  }

  return false;
}

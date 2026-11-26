/** Whether this browser has finished or skipped onboarding for a workspace. */
const key = (workspaceId: string) => `findr.onboarded.${workspaceId}`;

export function isOnboarded(workspaceId: string): boolean {
  try {
    return localStorage.getItem(key(workspaceId)) === '1';
  } catch {
    // Without storage, don't keep pushing people into onboarding.
    return true;
  }
}

export function markOnboarded(workspaceId: string) {
  try {
    localStorage.setItem(key(workspaceId), '1');
  } catch {
    // Not saved; harmless.
  }
}

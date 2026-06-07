/**
 * Legacy repo-file prefill for scan_results is removed.
 * Deployments use sd-artifacts analyze (Railpack) only.
 */
export function buildPrefilledScanResults(_repoRoot: string, _packagePath?: string): null {
	return null;
}

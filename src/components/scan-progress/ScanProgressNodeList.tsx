import { ProgressWorkflowChain, type ProgressWorkflowChainProps } from "@/components/progress/ProgressWorkflowChain";
import { SCAN_PROGRESS_NODES } from "@/components/scan-progress/scanProgressState";

export function ScanProgressNodeList(props: Omit<ProgressWorkflowChainProps, "nodes">) {
	return <ProgressWorkflowChain {...props} nodes={SCAN_PROGRESS_NODES} />;
}

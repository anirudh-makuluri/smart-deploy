import { ProgressWorkflowChain, type ProgressWorkflowChainProps } from "@/components/progress/ProgressWorkflowChain";
import { FEEDBACK_PROGRESS_NODES } from "@/components/feedback-progress/feedbackProgressConstants";

export function FeedbackWorkflowChain(props: Omit<ProgressWorkflowChainProps, "nodes">) {
	return <ProgressWorkflowChain {...props} nodes={FEEDBACK_PROGRESS_NODES} />;
}

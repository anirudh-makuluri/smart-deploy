import { FeedbackProgressFooter } from "@/components/feedback-progress/FeedbackProgressFooter";
import { FeedbackProgressHeader } from "@/components/feedback-progress/FeedbackProgressHeader";
import { FeedbackStreamPanel } from "@/components/feedback-progress/FeedbackStreamPanel";
import { FeedbackWorkflowChain } from "@/components/feedback-progress/FeedbackWorkflowChain";
import { useFeedbackProgressStream } from "@/components/feedback-progress/useFeedbackProgressStream";
import type { SDArtifactsResponse } from "@/app/types";

import type { FeedbackProgressPayload } from "@/components/feedback-progress/types";

export type { FeedbackProgressPayload };

type FeedbackProgressProps = {
	payload: FeedbackProgressPayload;
	repoName: string;
	serviceName: string;
	onComplete: (data: SDArtifactsResponse) => void;
	onCancel: () => void;
};

export default function FeedbackProgress({ payload, repoName, serviceName, onComplete, onCancel }: FeedbackProgressProps) {
	const { state, logsEndRef } = useFeedbackProgressStream({ payload, repoName, serviceName, onComplete });

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] bg-background/50 animate-in fade-in duration-500">
			<FeedbackProgressHeader />

			<div className="flex flex-col lg:flex-row gap-6 h-full">
				<FeedbackWorkflowChain
					activeNode={state.activeNode}
					completedNodes={state.completedNodes}
					failedNode={state.failedNode}
				/>
				<FeedbackStreamPanel logs={state.logs} progress={state.progress} logsEndRef={logsEndRef} />
			</div>

			<FeedbackProgressFooter onCancel={onCancel} />
		</div>
	);
}

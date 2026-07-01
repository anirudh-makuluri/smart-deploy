import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentDocCitation } from "@/lib/agentDocCitations";

type DeploymentAgentDocBadgesProps = {
	citations: AgentDocCitation[];
};

export function DeploymentAgentDocBadges({ citations }: DeploymentAgentDocBadgesProps) {
	if (citations.length === 0) {
		return null;
	}

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
			<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Docs</span>
			{citations.map((citation) => (
				<Badge key={citation.source} variant="secondary" asChild className="rounded-full px-2.5 py-0.5 text-[11px]">
					<Link href={citation.href} target="_blank" rel="noreferrer">
						<FileText className="size-3" />
						{citation.label}
					</Link>
				</Badge>
			))}
		</div>
	);
}
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

type ServiceLogsScrollButtonProps = {
	onScrollToBottom: () => void;
};

export function ServiceLogsScrollButton({ onScrollToBottom }: ServiceLogsScrollButtonProps) {
	return (
		<div className="absolute bottom-3 right-3 z-20">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				className="gap-2 shadow-lg bg-background/80 hover:bg-background/95"
				onClick={onScrollToBottom}
			>
				<ChevronDown className="size-4" />
				Scroll to bottom
			</Button>
		</div>
	);
}

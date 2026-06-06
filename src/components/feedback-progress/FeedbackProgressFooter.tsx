import { Button } from "@/components/ui/button";

type FeedbackProgressFooterProps = {
	onCancel: () => void;
};

export function FeedbackProgressFooter({ onCancel }: FeedbackProgressFooterProps) {
	return (
		<div className="flex items-center justify-end gap-3 mt-8 pt-6 border-t border-border/30">
			<Button variant="outline" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
				Cancel
			</Button>
			<Button disabled className="bg-primary/20 text-primary-foreground opacity-50">
				Improving…
			</Button>
		</div>
	);
}

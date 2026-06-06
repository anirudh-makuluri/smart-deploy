import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-parts";

type DeploymentHistoryErrorProps = {
	message: string;
};

export function DeploymentHistoryError({ message }: DeploymentHistoryErrorProps) {
	return (
		<Alert className="border-destructive/50 bg-destructive/10 text-muted-foreground">
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

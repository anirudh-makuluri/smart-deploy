import { Alert, AlertDescription } from "@/components/ui/alert";

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

import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";

export default function AuthPage() {
	return (
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<SmartDeployLogo showText size="md" className="self-center" />
				<LoginForm />
			</div>
		</div>
	);
}


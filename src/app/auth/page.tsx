import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";

type AuthPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
	const params = searchParams ? await searchParams : {};
	const error = typeof params.error === "string" ? params.error : undefined;
	if (error === "AccessDenied" || error === "CredentialsSignin") {
		redirect("/waiting-list");
	}

	return (
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<SmartDeployLogo showText size="md" className="self-center" />
				<LoginForm />
			</div>
		</div>
	);
}


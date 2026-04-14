import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

type AuthPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (session) {
		redirect("/home");
	}

	const params = searchParams ? await searchParams : {};
	const error = typeof params.error === "string" ? params.error : undefined;
	if (error) {
		redirect("/waiting-list");
	}

	return (
		<div className="landing-bg flex min-h-svh flex-col items-center justify-center px-5 py-8 text-foreground">
			<div className="flex w-full max-w-88 flex-col items-stretch gap-4">
				<SmartDeployLogo showText size="md" className="self-center" />
				<div className="flex flex-col gap-1 text-center">
					<h1 className="text-xl font-semibold tracking-tight text-foreground">Welcome</h1>
					<p className="text-sm text-muted-foreground">Sign in or create an account to continue</p>
				</div>
				<LoginForm />
			</div>
		</div>
	);
}


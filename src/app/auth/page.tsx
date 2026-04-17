import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import config from "@/config";

export const dynamic = "force-dynamic";

type AuthPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	try {
		session = await auth.api.getSession({ headers: await headers() });
	} catch (error) {
		console.error("Failed to read auth session for /auth page:", error);
	}
	if (session) {
		redirect("/home");
	}

	const params = searchParams ? await searchParams : {};
	const error = typeof params.error === "string" ? params.error : undefined;
	if (error && config.WAITING_LIST_ENABLED) {
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


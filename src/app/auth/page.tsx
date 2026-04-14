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
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<SmartDeployLogo showText size="md" className="self-center" />
				<LoginForm />
			</div>
		</div>
	);
}


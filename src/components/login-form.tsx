"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";

export function LoginForm({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div className={cn("flex flex-col gap-5", className)} {...props}>
			{/* Card-style container with landing theme */}
			<div className="rounded-xl border border-border bg-card p-6 shadow-lg">
				<h2 className="text-center text-xl font-semibold text-foreground mb-5">Welcome</h2>

				<div className="flex flex-col gap-3">
					<Button
						type="button"
						variant="outline"
						className="w-full h-11 border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
						onClick={() => signIn("google", { callbackUrl: "/home" })}
					>
						<GoogleIcon className="size-5 mr-2" />
						Login with Google
					</Button>
					<Button
						type="button"
						variant="outline"
						className="w-full h-11 border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
						onClick={() => signIn("github", { callbackUrl: "/home" })}
					>
						<GitHubIcon className="size-5 mr-2" />
						Login with GitHub
					</Button>
				</div>

				<div className="relative my-5">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t border-border" />
					</div>
					<div className="relative flex justify-center text-xs uppercase tracking-wider">
						<span className="bg-card px-2 text-muted-foreground">or</span>
					</div>
				</div>

				{/* Sign in with email and password (UI only — functionality later) */}
				<form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
					<div className="space-y-2">
						<Label htmlFor="auth-email" className="text-foreground text-sm">
							Email
						</Label>
						<Input
							id="auth-email"
							type="email"
							placeholder="you@example.com"
							className="h-11 border-border bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
							autoComplete="email"
							disabled
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="auth-password" className="text-foreground text-sm">
							Password
						</Label>
						<Input
							id="auth-password"
							type="password"
							placeholder="••••••••"
							className="h-11 border-border bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
							autoComplete="current-password"
							disabled
						/>
					</div>
					<Button
						type="submit"
						className="w-full h-11 landing-build-blue hover:opacity-95 text-white font-medium"
						disabled
					>
						Sign in with email
					</Button>
				</form>
			</div>

			<p className="text-center text-xs text-muted-foreground/70">
				By continuing, you agree to our{" "}
				<a href="#" className="text-primary hover:underline">
					Terms of Service
				</a>{" "}
				and{" "}
				<a href="#" className="text-primary hover:underline">
					Privacy Policy
				</a>
				.
			</p>
		</div>
	);
}

function GoogleIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden>
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				fill="#EA4335"
			/>
		</svg>
	);
}

function GitHubIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 98 96" aria-hidden>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
				fill="currentColor"
			/>
		</svg>
	);
}


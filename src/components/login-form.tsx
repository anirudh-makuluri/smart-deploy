"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
	type AuthLastMethod,
	readLastAuthMethod,
	writeLastAuthMethod,
} from "@/lib/auth-last-method";

const MIN_PASSWORD_LEN = 8;

const tabTriggerBase =
	"inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow,background-color] focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const tabTriggerActive =
	"bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30";

export function LoginForm({
	className,
	...props
}: React.ComponentProps<"div">) {
	const [mode, setMode] = React.useState<"signIn" | "signUp">("signIn");
	const [name, setName] = React.useState("");
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [pending, setPending] = React.useState<null | "google" | "github" | "email" | "signup">(null);
	const [lastUsedMethod, setLastUsedMethod] = React.useState<AuthLastMethod | null>(null);

	React.useEffect(() => {
		setLastUsedMethod(readLastAuthMethod());
	}, []);

	async function signInWithProvider(provider: "google" | "github") {
		writeLastAuthMethod(provider);
		setLastUsedMethod(provider);
		setPending(provider);
		try {
			await authClient.signIn.social({
				provider,
				callbackURL: "/home",
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Sign in failed");
		} finally {
			setPending(null);
		}
	}

	async function signInWithEmail(e: React.FormEvent) {
		e.preventDefault();
		const emailTrimmed = email.trim().toLowerCase();
		if (!emailTrimmed) {
			toast.error("Please enter an email");
			return;
		}
		if (!password) {
			toast.error("Please enter a password");
			return;
		}
		setPending("email");
		try {
			const res = await authClient.signIn.email({
				email: emailTrimmed,
				password,
				callbackURL: "/home",
			});
			if (res?.error) {
				toast.error(res.error.message || "Sign in failed");
				return;
			}
			writeLastAuthMethod("email");
			setLastUsedMethod("email");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Sign in failed");
		} finally {
			setPending(null);
		}
	}

	async function signUpWithEmail(e: React.FormEvent) {
		e.preventDefault();
		const nameTrimmed = name.trim();
		const emailTrimmed = email.trim().toLowerCase();
		if (!nameTrimmed) {
			toast.error("Please enter your name");
			return;
		}
		if (!emailTrimmed) {
			toast.error("Please enter an email");
			return;
		}
		if (password.length < MIN_PASSWORD_LEN) {
			toast.error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
			return;
		}
		setPending("signup");
		try {
			const res = await authClient.signUp.email({
				email: emailTrimmed,
				password,
				name: nameTrimmed,
				callbackURL: "/home",
			});
			if (res?.error) {
				toast.error(res.error.message || "Could not create account");
				return;
			}
			writeLastAuthMethod("email");
			setLastUsedMethod("email");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not create account");
		} finally {
			setPending(null);
		}
	}

	return (
		<div className={cn("flex w-full flex-col gap-3", className)} {...props}>
			<SocialProviderIconRow
				pending={pending}
				lastUsedMethod={lastUsedMethod}
				onGoogle={() => void signInWithProvider("google")}
				onGithub={() => void signInWithProvider("github")}
			/>

			<div
				role="tablist"
				aria-label="Email sign-in or registration"
				className="bg-muted text-muted-foreground grid h-9 w-full grid-cols-2 items-center justify-center rounded-lg p-[3px]"
			>
				<button
					type="button"
					role="tab"
					id="auth-tab-signin"
					aria-selected={mode === "signIn"}
					aria-controls="auth-panel-signin"
					tabIndex={mode === "signIn" ? 0 : -1}
					className={cn(
						tabTriggerBase,
						"text-foreground dark:text-muted-foreground",
						mode === "signIn" && tabTriggerActive,
					)}
					onClick={() => setMode("signIn")}
				>
					Sign in
				</button>
				<button
					type="button"
					role="tab"
					id="auth-tab-signup"
					aria-selected={mode === "signUp"}
					aria-controls="auth-panel-signup"
					tabIndex={mode === "signUp" ? 0 : -1}
					className={cn(
						tabTriggerBase,
						"text-foreground dark:text-muted-foreground",
						mode === "signUp" && tabTriggerActive,
					)}
					onClick={() => setMode("signUp")}
				>
					Create account
				</button>
			</div>

			<AnimatePresence mode="wait" initial={false}>
				{mode === "signIn" ? (
					<motion.div
						key="signIn"
						role="tabpanel"
						id="auth-panel-signin"
						aria-labelledby="auth-tab-signin"
						initial={{ opacity: 0, x: -10 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 8 }}
						transition={{ type: "spring", stiffness: 460, damping: 36 }}
						className="flex w-full flex-col gap-3"
					>
						<form className="flex flex-col gap-3" onSubmit={(e) => void signInWithEmail(e)}>
							<div className="space-y-1.5">
								<Label htmlFor="auth-email" className="text-foreground text-xs">
									Email
								</Label>
								<Input
									id="auth-email"
									type="email"
									placeholder="you@example.com"
									className="h-10 border-border bg-background/60 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
									autoComplete="email"
									disabled={pending !== null}
									value={email}
									onChange={(e) => setEmail(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="auth-password-signin" className="text-foreground text-xs">
									Password
								</Label>
								<Input
									id="auth-password-signin"
									type="password"
									placeholder="••••••••"
									className="h-10 border-border bg-background/60 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
									autoComplete="current-password"
									disabled={pending !== null}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
								/>
							</div>
							<div className="relative mt-0.5">
								<Button
									type="submit"
									className="landing-build-blue relative z-0 h-10 w-full text-sm font-medium text-white hover:opacity-95"
									disabled={pending !== null}
								>
									{pending === "email" ? "Signing in…" : "Sign in"}
								</Button>
								{lastUsedMethod === "email" && (
									<div className="relative z-10 -mt-2.5 flex justify-center">
										<LastUsedBadge className="shadow-sm ring-2 ring-background" />
									</div>
								)}
							</div>
						</form>
					</motion.div>
				) : (
					<motion.div
						key="signUp"
						role="tabpanel"
						id="auth-panel-signup"
						aria-labelledby="auth-tab-signup"
						initial={{ opacity: 0, x: 10 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -8 }}
						transition={{ type: "spring", stiffness: 460, damping: 36 }}
						className="flex w-full flex-col gap-3"
					>
						<form className="flex flex-col gap-3" onSubmit={(e) => void signUpWithEmail(e)}>
							<div className="space-y-1.5">
								<Label htmlFor="auth-name" className="text-foreground text-xs">
									Name
								</Label>
								<Input
									id="auth-name"
									type="text"
									placeholder="Ada Lovelace"
									className="h-10 border-border bg-background/60 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
									autoComplete="name"
									disabled={pending !== null}
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="auth-email-signup" className="text-foreground text-xs">
									Email
								</Label>
								<Input
									id="auth-email-signup"
									type="email"
									placeholder="you@example.com"
									className="h-10 border-border bg-background/60 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
									autoComplete="email"
									disabled={pending !== null}
									value={email}
									onChange={(e) => setEmail(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="auth-password-signup" className="text-foreground text-xs">
									Password
								</Label>
								<Input
									id="auth-password-signup"
									type="password"
									placeholder="••••••••"
									className="h-10 border-border bg-background/60 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
									autoComplete="new-password"
									disabled={pending !== null}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
								/>
								<p className="text-[0.7rem] leading-tight text-muted-foreground">
									Min. {MIN_PASSWORD_LEN} characters
								</p>
							</div>
							<div className="relative mt-0.5">
								<Button
									type="submit"
									className="landing-build-blue relative z-0 h-10 w-full text-sm font-medium text-white hover:opacity-95"
									disabled={pending !== null}
								>
									{pending === "signup" ? "Creating account…" : "Create account"}
								</Button>
								{lastUsedMethod === "email" && (
									<div className="relative z-10 -mt-2.5 flex justify-center">
										<LastUsedBadge className="shadow-sm ring-2 ring-background" />
									</div>
								)}
							</div>
						</form>
					</motion.div>
				)}
			</AnimatePresence>

			<p className="text-center text-[0.7rem] leading-snug text-muted-foreground/80">
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

function LastUsedBadge({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md border border-primary bg-primary px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-primary-foreground",
				className,
			)}
		>
			Last used
		</span>
	);
}

function SocialProviderIconRow({
	pending,
	lastUsedMethod,
	onGoogle,
	onGithub,
}: {
	pending: null | "google" | "github" | "email" | "signup";
	lastUsedMethod: AuthLastMethod | null;
	onGoogle: () => void;
	onGithub: () => void;
}) {
	const busy = pending !== null;
	const providerBtnClass =
		"h-10 w-full min-w-0 shrink justify-start gap-2.5 rounded-lg border-border bg-background/60 px-3 text-left text-sm font-medium text-foreground hover:bg-secondary";
	return (
		<div
			className={cn("flex flex-row gap-3", (lastUsedMethod === "google" || lastUsedMethod === "github") && "pb-1")}
			role="group"
			aria-label="Continue with Google or GitHub"
		>
			<div className="flex min-w-0 flex-1 flex-col items-center">
				<Button
					type="button"
					variant="outline"
					className={cn(providerBtnClass, "relative z-0")}
					disabled={busy}
					aria-label="Continue with Google"
					onClick={onGoogle}
				>
					<span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
						{pending === "google" ? (
							<Loader2 className="size-[1.15rem] animate-spin text-muted-foreground" />
						) : (
							<GoogleIcon className="size-[1.15rem]" />
						)}
					</span>
					<span className="truncate">Google</span>
				</Button>
				{lastUsedMethod === "google" && (
					<span className="relative z-10 -mt-2.5">
						<LastUsedBadge className="shadow-sm ring-2 ring-background" />
					</span>
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center">
				<Button
					type="button"
					variant="outline"
					className={cn(providerBtnClass, "relative z-0")}
					disabled={busy}
					aria-label="Continue with GitHub"
					onClick={onGithub}
				>
					<span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
						{pending === "github" ? (
							<Loader2 className="size-[1.15rem] animate-spin text-muted-foreground" />
						) : (
							<GitHubIcon className="size-[1.15rem]" />
						)}
					</span>
					<span className="truncate">GitHub</span>
				</Button>
				{lastUsedMethod === "github" && (
					<span className="relative z-10 -mt-2.5">
						<LastUsedBadge className="shadow-sm ring-2 ring-background" />
					</span>
				)}
			</div>
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

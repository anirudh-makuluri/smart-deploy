import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Mail } from "lucide-react";

export default function WaitingListPage() {
	return (
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center p-6 text-foreground">
			<div className="flex w-full max-w-md flex-col gap-6">
				<SmartDeployLogo showText size="md" className="self-center" />
				
				<div className="rounded-xl border border-border bg-card p-8 shadow-lg text-center">
					<div className="flex justify-center mb-4">
						<div className="rounded-full bg-primary/10 p-4">
							<Mail className="size-8 text-primary" />
						</div>
					</div>
					
					<h1 className="text-2xl font-semibold text-foreground mb-3">
						You're on the waiting list
					</h1>
					
					<p className="text-muted-foreground mb-6 leading-relaxed">
						Thanks for your interest in Smart Deploy! We're currently in a limited beta phase and 
						are gradually rolling out access to users.
					</p>
					
					<p className="text-muted-foreground mb-6 leading-relaxed">
						To get access sooner, please email{" "}
						<a 
							href="mailto:anirudh.makuluri@gmail.com" 
							className="text-primary hover:underline font-medium"
						>
							anirudh.makuluri@gmail.com
						</a>
						{" "}and let him know you'd like to be added to the platform.
					</p>
					
					<div className="flex flex-col gap-3 mt-6">
						<Button
							asChild
							className="w-full hidden h-11 landing-build-blue hover:opacity-95 text-white font-medium"
						>
							<a href="mailto:anirudh.makuluri@gmail.com?subject=Request%20for%20Smart%20Deploy%20Access">
								<Mail className="size-4 mr-2" />
								Send Email Request
							</a>
						</Button>
						
						<Button
							asChild
							variant="outline"
							className="w-full h-11 border-border bg-transparent text-foreground hover:bg-secondary"
						>
							<Link href="/auth">
								Back to Login
							</Link>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

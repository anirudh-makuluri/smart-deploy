import Link from "next/link";
import { Boxes } from "lucide-react";
import LanguageIcon from "@/components/LanguageIcon";
import type { RepoCard } from "@/components/dashboard/dashboardMainUtils";

type DashboardOverviewViewProps = {
	repoCards: RepoCard[];
	isLoading: boolean;
};

export default function DashboardOverviewView({ repoCards, isLoading }: DashboardOverviewViewProps) {
	return (
		<div className="space-y-6">
			{repoCards.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
					<Boxes className="size-12 text-muted-foreground/70 mb-4" />
					<p className="text-foreground font-medium">
						{isLoading ? "Loading…" : "No detected repositories yet"}
					</p>
					<p className="mt-1 max-w-sm text-sm text-muted-foreground">
						{isLoading
							? "Fetching your data."
							: "Open Repositories, pick a repo, and we will detect and save its services there."}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					{repoCards.map(({ owner, name, subtitle, hasFailed, language }) => (
						<div
							key={`${owner}/${name}`}
							className={`rounded-xl border p-4 bg-card hover:border-primary/40 transition-colors text-left ${hasFailed ? "border-destructive/50" : "border-border"}`}
						>
							<Link href={`/${owner}/${name}`} className="flex items-center gap-3 min-w-0">
								<LanguageIcon language={language} />
								<div className="min-w-0">
									<p className="font-semibold text-foreground truncate">
										{name}
									</p>
									<p className="text-sm text-muted-foreground">{subtitle}</p>
								</div>
							</Link>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

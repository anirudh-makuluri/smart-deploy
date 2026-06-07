import Link from "next/link";
import { ChevronRight, User } from "lucide-react";

type HeaderBreadcrumbsProps = {
	isHome: boolean;
	isRepoPage: boolean;
	sessionName?: string | null;
	owner?: string;
	repo?: string;
	activeServiceName?: string | null;
	onRepoClick: () => void;
};

export default function HeaderBreadcrumbs({
	isHome,
	isRepoPage,
	sessionName,
	owner,
	repo,
	activeServiceName,
	onRepoClick,
}: HeaderBreadcrumbsProps) {
	if (!isHome && !isRepoPage) return null;

	return (
		<nav className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm font-medium">
			<ChevronRight className="size-4 text-muted-foreground/30" />
			{isHome ? (
				<div className="flex min-w-0 items-center gap-2 text-foreground/80">
					<User className="size-3.5 shrink-0" />
					<span className="truncate">{sessionName || "User Dashboard"}</span>
				</div>
			) : (
				<div className="flex items-center gap-2 overflow-hidden">
					<Link
						href="/home"
						className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors truncate"
					>
						<User className="size-3.5" />
						<span>{sessionName || owner}</span>
					</Link>
					<span className="text-muted-foreground/30">/</span>
					<Link
						href={`/${owner}/${repo}`}
						className={`transition-colors truncate ${!activeServiceName ? "text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
						onClick={onRepoClick}
					>
						{repo}
					</Link>
					{activeServiceName ? (
						<>
							<span className="text-muted-foreground/30">/</span>
							<span className="text-foreground font-bold truncate">{activeServiceName}</span>
						</>
					) : null}
				</div>
			)}
		</nav>
	);
}

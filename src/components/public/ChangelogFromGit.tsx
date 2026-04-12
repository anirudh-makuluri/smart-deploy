import Link from "next/link";
import { commitUrl, groupCommitsByDate, pullRequestUrl, type GitChangelogCommit } from "@/lib/changelog-from-git";

export function ChangelogFromGit({ commits }: { commits: GitChangelogCommit[] }) {
	if (commits.length === 0) {
		return (
			<div className="mt-10 rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-sm leading-6 text-muted-foreground">
				<p className="font-medium text-foreground">Changelog snapshot missing or empty</p>
				<p className="mt-2">
					Expected <code className="font-mono text-xs">src/data/changelog-commits.json</code>. From a clone with{" "}
					<code className="font-mono text-xs">git</code>, run{" "}
					<code className="font-mono text-xs">npm run changelog:snapshot</code> and commit the updated JSON.
				</p>
			</div>
		);
	}

	const groups = groupCommitsByDate(commits);

	return (
		<div className="mt-10 space-y-12">
			{groups.map(({ date, commits: dayCommits }) => (
				<section key={date} aria-labelledby={`changelog-${date}`}>
					<h2
						id={`changelog-${date}`}
						className="border-b border-border pb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
					>
						{date}
					</h2>
					<ul className="mt-4 space-y-5">
						{dayCommits.map((c) => (
							<li key={c.hash} className="text-sm leading-relaxed">
								<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
									<Link
										href={commitUrl(c.hash)}
										className="font-mono text-xs font-medium text-primary tabular-nums underline-offset-2 hover:underline"
										title={c.hash}
									>
										{c.shortHash}
									</Link>
									<span className="text-xs text-muted-foreground">{c.author}</span>
									{c.prNumber ? (
										<Link
											href={pullRequestUrl(c.prNumber)}
											className="font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
										>
											PR #{c.prNumber}
										</Link>
									) : null}
								</div>
								<p className="mt-1.5 text-[13px] leading-6 text-foreground">{c.subject}</p>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

import type { ReactNode } from "react";

type ConfigTabsSectionLayoutProps = {
	icon: ReactNode;
	title: string;
	description: ReactNode;
	children: ReactNode;
	showTopBorder?: boolean;
};

export function ConfigTabsSectionLayout({
	icon,
	title,
	description,
	children,
	showTopBorder = true,
}: ConfigTabsSectionLayoutProps) {
	return (
		<div
			className={
				showTopBorder
					? "flex flex-col md:flex-row md:items-start justify-between gap-6 pt-10 border-t border-white/5"
					: "space-y-4"
			}
		>
			<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
				<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
					{icon}
					{title}
				</div>
				<p className="text-[10px] text-muted-foreground/40 leading-relaxed">{description}</p>
			</div>
			{children}
		</div>
	);
}

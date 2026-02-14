import * as React from "react";

type MenuItem = { id: "overview" | "env" | "logs" | "history"; label: string };

const MENU_ITEMS: MenuItem[] = [
	{ id: "overview", label: "Overview" },
	{ id: "env", label: "Environment" },
	{ id: "logs", label: "Logs" },
	{ id: "history", label: "Deployment History" },
];

export type MenuSection = MenuItem["id"];

type DeployWorkspaceMenuProps = {
	showMenu: boolean;
	showFullMenu: boolean;
	activeSection: MenuSection;
	onChange: (section: MenuSection) => void;
};

export default function DeployWorkspaceMenu({
	showMenu,
	showFullMenu,
	activeSection,
	onChange,
}: DeployWorkspaceMenuProps) {
	if (!showMenu) return null;
	const visibleIds = showFullMenu ? MENU_ITEMS.map((item) => item.id) : ["env", "logs"];

	return (
		<nav className="border-b border-border bg-background/90">
			<div className="mx-auto max-w-6xl px-6">
				<div className="flex items-center gap-6 text-sm">
					{MENU_ITEMS.filter((item) => visibleIds.includes(item.id)).map((item) => (
						<button
							key={item.id}
							onClick={() => onChange(item.id)}
							className={`py-4 border-b-2 transition-colors cursor-pointer ${
								activeSection === item.id
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground"
							}`}
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
		</nav>
	);
}

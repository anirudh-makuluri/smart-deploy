import * as React from "react";
import { Boxes, FileSearch, LayoutDashboard, Logs, Settings2, History } from "lucide-react";
import { SidebarCollapseToggle } from "@/components/SidebarCollapseToggle";

type MenuItem = { id: "overview" | "setup" | "scan" | "blueprint" | "logs" | "history"; label: string };

const MENU_ITEMS: MenuItem[] = [
	{ id: "overview", label: "Overview" },
	{ id: "setup", label: "Setup" },
	{ id: "scan", label: "Scan" },
	{ id: "blueprint", label: "Preview" },
	{ id: "logs", label: "Logs" },
	{ id: "history", label: "Deployment History" },
];

export type MenuSection = MenuItem["id"];

type DeployWorkspaceMenuProps = {
	activeSection: MenuSection;
	onChange: (section: MenuSection) => void;
	footer?: React.ReactNode;
	collapsed?: boolean;
	onToggleCollapsed?: () => void;
};

const MENU_ICONS: Record<MenuSection, React.ComponentType<{ className?: string }>> = {
	overview: LayoutDashboard,
	setup: Settings2,
	scan: FileSearch,
	blueprint: Boxes,
	logs: Logs,
	history: History,
};

export default function DeployWorkspaceMenu({
	activeSection,
	onChange,
	footer,
	collapsed = false,
	onToggleCollapsed,
}: DeployWorkspaceMenuProps) {
	return (
		<nav className="flex h-full min-h-0 flex-col">
			<div className={`border-b border-white/6 ${collapsed ? "px-3 py-4" : "px-4 py-4"}`}>
				<div className={`flex items-center ${collapsed ? "justify-center" : "justify-between gap-3"}`}>
					{!collapsed ? (
						<p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground/65">Workspace</p>
					) : null}
					{onToggleCollapsed ? (
						<SidebarCollapseToggle collapsed={collapsed} onToggle={onToggleCollapsed} />
					) : null}
				</div>
			</div>
			<div className={`flex flex-1 flex-col gap-1 overflow-auto stealth-scrollbar ${collapsed ? "p-2" : "p-3"}`}>
				{MENU_ITEMS.map((item) => (
					(() => {
						const Icon = MENU_ICONS[item.id];
						return (
						<button
							key={item.id}
							onClick={() => onChange(item.id)}
							title={collapsed ? item.label : undefined}
							className={`flex w-full items-center rounded-2xl text-left text-sm font-medium transition-colors cursor-pointer ${
								activeSection === item.id
									? "bg-white/[0.05] text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
									: "text-muted-foreground hover:bg-white/[0.025] hover:text-foreground"
							} ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3"}`}
						>
							<Icon className="size-4 shrink-0" />
							{!collapsed ? <span>{item.label}</span> : null}
						</button>
						);
					})()
				))}
			</div>
			{footer ? (
				<div className={`border-t border-white/6 ${collapsed ? "p-2" : "p-3"}`}>
					{footer}
				</div>
			) : null}
		</nav>
	);
}

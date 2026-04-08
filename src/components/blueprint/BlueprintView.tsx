"use client";

import * as React from "react";
import type { BlueprintEdge, BlueprintNode } from "@/components/blueprint/blueprint-types";
import { buildBlueprintModel } from "@/components/blueprint/blueprint-mappers";
import { BLUEPRINT_NODE_FIELDS } from "@/components/blueprint/blueprint-fields";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import configClient from "@/config.client";
import {
	Boxes,
	Cable,
	FileInput,
	FileCode2,
	Upload,
	Globe,
	GitBranch,
	LayoutGrid,
	Minus,
	Network,
	Plus,
	Server,
	Settings2,
	Trash2,
	Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildEnvVarsString, parseEnvLinesToEntries, parseEnvVarsToDisplay } from "@/lib/utils";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetDescription,
	SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type BlueprintViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
	branchOptions: string[];
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onUpdateScanResults: (updater: (current: SDArtifactsResponse) => SDArtifactsResponse) => Promise<void> | void;
};

type EnvVarEntry = {
	name: string;
	value: string;
};

const KIND_STYLES: Record<
	BlueprintNode["kind"],
	{ icon: React.ComponentType<{ className?: string }>; chip: string; accent: string; panel: string }
> = {
	deployConfig: {
		icon: Cable,
		chip: "DeployConfig",
		accent: "text-primary",
		panel: "from-primary/25 via-primary/10 to-transparent",
	},
	service: {
		icon: Boxes,
		chip: "Service",
		accent: "text-sky-300",
		panel: "from-sky-500/20 via-sky-500/10 to-transparent",
	},
	branch: {
		icon: GitBranch,
		chip: "Branch",
		accent: "text-indigo-300",
		panel: "from-indigo-500/20 via-indigo-500/10 to-transparent",
	},
	envVars: {
		icon: FileInput,
		chip: "Env Vars",
		accent: "text-lime-300",
		panel: "from-lime-500/20 via-lime-500/10 to-transparent",
	},
	dockerfile: {
		icon: FileCode2,
		chip: "Dockerfile",
		accent: "text-emerald-300",
		panel: "from-emerald-500/20 via-emerald-500/10 to-transparent",
	},
	compose: {
		icon: LayoutGrid,
		chip: "Compose",
		accent: "text-fuchsia-300",
		panel: "from-fuchsia-500/20 via-fuchsia-500/10 to-transparent",
	},
	nginx: {
		icon: Waypoints,
		chip: "Ingress",
		accent: "text-amber-300",
		panel: "from-amber-500/20 via-amber-500/10 to-transparent",
	},
	customDomain: {
		icon: Globe,
		chip: "Domain",
		accent: "text-cyan-300",
		panel: "from-cyan-500/20 via-cyan-500/10 to-transparent",
	},
	infrastructure: {
		icon: Settings2,
		chip: "Infrastructure",
		accent: "text-violet-300",
		panel: "from-violet-500/20 via-violet-500/10 to-transparent",
	},
};

function getNodeCenter(node: BlueprintNode) {
	return {
		x: node.x + (node.width ?? 180) / 2,
		y: node.y + (node.height ?? 92) / 2,
	};
}

function EdgeLayer({ nodes, edges }: { nodes: BlueprintNode[]; edges: BlueprintEdge[] }) {
	const byId = new Map(nodes.map((node) => [node.id, node]));

	return (
		<svg className="absolute inset-0 h-full w-full overflow-visible">
			<defs>
				<linearGradient id="edgeStroke" x1="0%" x2="100%" y1="0%" y2="100%">
					<stop offset="0%" stopColor="rgba(134,239,172,0.25)" />
					<stop offset="100%" stopColor="rgba(96,165,250,0.2)" />
				</linearGradient>
			</defs>
			{edges.map((edge) => {
				const from = byId.get(edge.from);
				const to = byId.get(edge.to);
				if (!from || !to) return null;

				const start = getNodeCenter(from);
				const end = getNodeCenter(to);
				const isReference = edge.kind === "reference";
				const startX = start.x < end.x ? from.x + (from.width ?? 220) : from.x;
				const endX = start.x < end.x ? to.x : to.x + (to.width ?? 220);
				const startY = start.y;
				const endY = end.y;
				const elbowX = start.x < end.x
					? startX + Math.max(48, (endX - startX) / 2)
					: startX - Math.max(48, (startX - endX) / 2);
				const path = `M ${startX} ${startY} L ${elbowX} ${startY} L ${elbowX} ${endY} L ${endX} ${endY}`;

				return (
					<g key={edge.id}>
						<path
							d={path}
							fill="none"
							stroke={isReference ? "rgba(148,163,184,0.25)" : "url(#edgeStroke)"}
							strokeWidth={isReference ? "1.5" : "2"}
							strokeDasharray={isReference ? "4 10" : "8 8"}
						/>
						<circle cx={start.x} cy={start.y} r="3.5" fill="rgba(186,230,253,0.8)" />
						<circle cx={end.x} cy={end.y} r="3.5" fill="rgba(196,181,253,0.85)" />
					</g>
				);
			})}
		</svg>
	);
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.6;

function clampZoom(value: number) {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function formatFieldValue(value: string | number | boolean | null | undefined) {
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (value === null || value === undefined || value === "") return "Not set";
	return String(value);
}

function isInteractiveNode(node: BlueprintNode) {
	return node.kind !== "deployConfig";
}

const DOMAIN_SUFFIX = configClient.NEXT_PUBLIC_VERCEL_DOMAIN || "smart-deploy.xyz";
type LaneGroup = {
	id: string;
	label: string;
	kinds: BlueprintNode["kind"][];
};

const LANE_GROUPS: LaneGroup[] = [
	{ id: "context", label: "Context", kinds: ["service", "branch", "envVars"] },
	{ id: "artifacts", label: "Artifacts", kinds: ["dockerfile", "compose", "nginx"] },
	{ id: "infrastructure", label: "Infrastructure", kinds: ["infrastructure", "customDomain"] },
	{ id: "config", label: "Config", kinds: ["deployConfig"] },
];

function getSubdomainFromCustomUrl(url: string) {
	let raw = url.trim();
	if (!raw) return "";
	raw = raw.replace(/^https?:\/\//, "");
	if (raw.endsWith(`.${DOMAIN_SUFFIX}`)) {
		return raw.slice(0, -(DOMAIN_SUFFIX.length + 1));
	}
	return raw.split(".")[0] || "";
}

function buildDraftDataFromNode(node: BlueprintNode | null) {
	if (!node?.data) return {};
	if (node.kind === "customDomain") {
		return {
			url: getSubdomainFromCustomUrl(String(node.data.url ?? "")),
		};
	}
	return Object.fromEntries(
		Object.entries(node.data).map(([key, value]) => [key, value == null ? "" : String(value)])
	);
}

function getLaneSpecs(nodes: BlueprintNode[]) {
	return LANE_GROUPS.map((group) => {
		const laneNodes = nodes.filter((node) => group.kinds.includes(node.kind));

		if (laneNodes.length === 0) return null;

		const minX = Math.min(...laneNodes.map((node) => node.x));
		const minY = Math.min(...laneNodes.map((node) => node.y));
		const maxX = Math.max(...laneNodes.map((node) => node.x + (node.width ?? 220)));
		const maxY = Math.max(...laneNodes.map((node) => node.y + (node.height ?? 150)));

		return {
			id: group.id,
			label: group.label,
			x: minX - 72,
			y: Math.max(24, minY - 56),
			width: Math.max(320, maxX - minX + 144),
			height: Math.max(260, maxY - minY + 112),
		};
	}).filter((lane): lane is NonNullable<typeof lane> => lane !== null);
}

export default function BlueprintView({
	deployment,
	scanResults,
	branchOptions,
	onUpdateDeployment,
	onUpdateScanResults,
}: BlueprintViewProps) {
	const model = React.useMemo(
		() => buildBlueprintModel({ deployment, scanResults }),
		[deployment, scanResults]
	);

	const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
	const [isDetailOpen, setIsDetailOpen] = React.useState(false);
	const [nodePositions, setNodePositions] = React.useState<Record<string, { x: number; y: number }>>({});
	const [zoom, setZoom] = React.useState(1);
	const [pan, setPan] = React.useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = React.useState(false);
	const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
	const [savingFieldId, setSavingFieldId] = React.useState<string | null>(null);
	const [draftData, setDraftData] = React.useState<Record<string, string>>({});
	const [envDraft, setEnvDraft] = React.useState<EnvVarEntry[]>([]);
	const [showUnsavedDialog, setShowUnsavedDialog] = React.useState(false);
	const canvasRef = React.useRef<HTMLDivElement>(null);
	const envFileInputRef = React.useRef<HTMLInputElement>(null);
	const panStartRef = React.useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
	const dragStartRef = React.useRef<{ pointerX: number; pointerY: number; nodeX: number; nodeY: number } | null>(null);
	const dragMovedRef = React.useRef(false);

	React.useEffect(() => {
		if (!model.nodes.length) {
			setSelectedNodeId(null);
			return;
		}

		if (!selectedNodeId || !model.nodes.some((node) => node.id === selectedNodeId)) {
			setSelectedNodeId(model.nodes[0].id);
		}
	}, [model.nodes, selectedNodeId]);

	const defaultNodePositions = React.useMemo(
		() =>
			Object.fromEntries(
				model.nodes.map((node) => [
					node.id,
					{
						x: node.x,
						y: node.y,
					},
				])
			),
		[model.nodes]
	);

	React.useEffect(() => {
		setNodePositions(defaultNodePositions);
	}, [defaultNodePositions]);

	const nodesWithPositions = React.useMemo(
		() =>
			model.nodes.map((node) => ({
				...node,
				x: nodePositions[node.id]?.x ?? node.x,
				y: nodePositions[node.id]?.y ?? node.y,
			})),
		[model.nodes, nodePositions]
	);
	const selectedNode = React.useMemo(
		() => nodesWithPositions.find((node) => node.id === selectedNodeId) ?? null,
		[nodesWithPositions, selectedNodeId]
	);
	const selectedNodeIsDirty = isDirty(selectedNode);

	React.useEffect(() => {
		if (selectedNode?.kind === "envVars") {
			const value = String(selectedNode.data?.value ?? "");
			const entries = parseEnvVarsToDisplay(value);
			setDraftData(buildDraftDataFromNode(selectedNode));
			setEnvDraft(entries.length > 0 ? entries : [{ name: "", value: "" }]);
			return;
		}
		setDraftData(buildDraftDataFromNode(selectedNode));
	}, [selectedNode]);

	React.useEffect(() => {
		if (selectedNode?.kind === "envVars") {
			const value = String(selectedNode.data?.value ?? "");
			const entries = parseEnvVarsToDisplay(value);
			setEnvDraft(entries.length > 0 ? entries : [{ name: "", value: "" }]);
			return;
		}
		setEnvDraft([]);
	}, [selectedNode]);

	const surfaceWidth = Math.max(1680, ...nodesWithPositions.map((node) => node.x + (node.width ?? 220) + 180));
	const surfaceHeight = Math.max(1040, ...nodesWithPositions.map((node) => node.y + (node.height ?? 150) + 180));
	const laneSpecs = React.useMemo(() => getLaneSpecs(nodesWithPositions), [nodesWithPositions]);

	const fitToView = React.useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || nodesWithPositions.length === 0) return;

		const minX = Math.min(...nodesWithPositions.map((node) => node.x));
		const minY = Math.min(...nodesWithPositions.map((node) => node.y));
		const maxX = Math.max(...nodesWithPositions.map((node) => node.x + (node.width ?? 220)));
		const maxY = Math.max(...nodesWithPositions.map((node) => node.y + (node.height ?? 150)));

		const boundsWidth = Math.max(1, maxX - minX);
		const boundsHeight = Math.max(1, maxY - minY);
		const viewportWidth = canvas.clientWidth;
		const viewportHeight = canvas.clientHeight;

		const horizontalPadding = 120;
		const topPadding = 80;
		const bottomPadding = 120;

		const fittedZoom = clampZoom(
			Math.min(
				(viewportWidth - horizontalPadding * 2) / boundsWidth,
				(viewportHeight - topPadding - bottomPadding) / boundsHeight
			)
		);

		setZoom(fittedZoom);
		setPan({
			x: (viewportWidth - boundsWidth * fittedZoom) / 2 - minX * fittedZoom,
			y: (viewportHeight - boundsHeight * fittedZoom) / 2 - minY * fittedZoom,
		});
	}, [nodesWithPositions]);

	React.useLayoutEffect(() => {
		fitToView();
	}, [fitToView]);

	function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if ((event.target as HTMLElement).closest("button")) return;
		panStartRef.current = {
			x: event.clientX,
			y: event.clientY,
			originX: pan.x,
			originY: pan.y,
		};
		setIsPanning(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
		if (draggingNodeId && dragStartRef.current) {
			const deltaX = (event.clientX - dragStartRef.current.pointerX) / zoom;
			const deltaY = (event.clientY - dragStartRef.current.pointerY) / zoom;
			if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
				dragMovedRef.current = true;
			}
			setNodePositions((current) => ({
				...current,
				[draggingNodeId]: {
					x: dragStartRef.current!.nodeX + deltaX,
					y: dragStartRef.current!.nodeY + deltaY,
				},
			}));
			return;
		}
		if (!panStartRef.current) return;
		const deltaX = event.clientX - panStartRef.current.x;
		const deltaY = event.clientY - panStartRef.current.y;
		setPan({
			x: panStartRef.current.originX + deltaX,
			y: panStartRef.current.originY + deltaY,
		});
	}

	function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
		const releasedNodeId = draggingNodeId;
		const releasedNode = releasedNodeId
			? nodesWithPositions.find((node) => node.id === releasedNodeId) ?? null
			: null;
		const shouldOpenDetails = releasedNode !== null && isInteractiveNode(releasedNode) && !dragMovedRef.current;

		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		panStartRef.current = null;
		dragStartRef.current = null;
		setDraggingNodeId(null);
		setIsPanning(false);
		if (releasedNodeId && shouldOpenDetails) {
			setSelectedNodeId(releasedNodeId);
			setIsDetailOpen(true);
		}
	}

	function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
		event.preventDefault();
		setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 0.08 : -0.08)));
	}

	function getFieldOptions(node: BlueprintNode, key: string) {
		if (key === "branch") {
			return branchOptions.map((branch) => ({ value: branch, label: branch }));
		}
		return BLUEPRINT_NODE_FIELDS[node.kind].find((field) => field.key === key)?.options ?? [];
	}

	function handleResetView() {
		setNodePositions(defaultNodePositions);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				fitToView();
			});
		});
	}

	function resetDrafts(node: BlueprintNode | null) {
		setDraftData(buildDraftDataFromNode(node));
		if (node?.kind === "envVars") {
			const entries = parseEnvVarsToDisplay(String(node.data?.value ?? ""));
			setEnvDraft(entries.length > 0 ? entries : [{ name: "", value: "" }]);
			return;
		}
		setEnvDraft([]);
	}

	function getCurrentFieldValue(node: BlueprintNode, key: string) {
		if (node.kind === "envVars" && key === "value") {
			return buildEnvVarsString(envDraft.filter((entry) => entry.name.trim() || entry.value.trim()));
		}
		return draftData[key] ?? String(node.data?.[key] ?? "");
	}

	function isDirty(node: BlueprintNode | null) {
		if (!node) return false;
		if (node.kind === "envVars") {
			const original = String(node.data?.value ?? "");
			const current = buildEnvVarsString(envDraft.filter((entry) => entry.name.trim() || entry.value.trim()));
			return current !== original;
		}
		if (node.kind === "customDomain") {
			return getSubdomainFromCustomUrl(String(node.data?.url ?? "")) !== (draftData.url ?? "");
		}
		return BLUEPRINT_NODE_FIELDS[node.kind]
			.filter((field) => field.editable)
			.some((field) => String(node.data?.[field.key] ?? "") !== (draftData[field.key] ?? ""));
	}

	async function handleFieldSave(node: BlueprintNode, key: string, nextValue: string) {
		const fieldId = `${node.id}:${key}`;
		setSavingFieldId(fieldId);
		try {
			switch (node.kind) {
				case "branch":
					if (key === "branch") {
						await onUpdateDeployment({ branch: nextValue.trim() || "main" });
					}
					break;
				case "deployConfig":
				case "infrastructure":
					if (key === "branch") {
						await onUpdateDeployment({ branch: nextValue.trim() || "main" });
					}
					if (key === "region") {
						await onUpdateDeployment({ awsRegion: nextValue.trim() || deployment.awsRegion });
					}
					if (key === "provider") {
						const provider = nextValue as DeployConfig["cloudProvider"];
						await onUpdateDeployment({
							cloudProvider: provider,
							deploymentTarget: provider === "gcp" ? "cloud_run" : "ec2",
						});
					}
					if (key === "target") {
						const target = nextValue as DeployConfig["deploymentTarget"];
						await onUpdateDeployment({
							deploymentTarget: target,
							cloudProvider: target === "cloud_run" ? "gcp" : "aws",
						});
					}
					if (key === "instanceType") {
						await onUpdateDeployment({
							ec2: {
								...(deployment.ec2 ?? {}),
								instanceType: nextValue,
							} as DeployConfig["ec2"],
						});
					}
					break;
				case "envVars":
					if (key === "value") {
						await onUpdateDeployment({ envVars: nextValue });
					}
					break;
				case "customDomain":
					if (key === "url") {
						const subdomain = nextValue.trim();
						await onUpdateDeployment({
							liveUrl: subdomain ? `https://${subdomain}.${DOMAIN_SUFFIX}` : null,
						});
					}
					break;
				case "service":
					break;
				case "dockerfile":
					if (key === "fileName" || key === "buildContext" || key === "content") {
						await onUpdateScanResults((current) => {
							const service =
								(current.services ?? []).find((item) => item.name === deployment.serviceName) ??
								(current.services ?? [])[0];
							const dockerfilePath = service?.dockerfile_path;
							if (!dockerfilePath || !current.dockerfiles?.[dockerfilePath]) return current;

							const nextDockerfiles = { ...(current.dockerfiles ?? {}) };
							let nextServices = current.services ?? [];

							if (key === "content") {
								nextDockerfiles[dockerfilePath] = nextValue;
							}

							if (key === "buildContext") {
								nextServices = nextServices.map((item) =>
									item.name === deployment.serviceName
										? { ...item, build_context: nextValue.trim() || "." }
										: item
								);
							}

							if (key === "fileName") {
								const nextPath = nextValue.trim() || dockerfilePath;
								if (nextPath !== dockerfilePath) {
									nextDockerfiles[nextPath] = nextDockerfiles[dockerfilePath];
									delete nextDockerfiles[dockerfilePath];
									nextServices = nextServices.map((item) =>
										item.name === deployment.serviceName
											? { ...item, dockerfile_path: nextPath }
											: item
									);
								}
							}

							return {
								...current,
								dockerfiles: nextDockerfiles,
								services: nextServices,
							};
						});
					}
					break;
				case "compose":
					if (key === "content") {
						await onUpdateScanResults((current) => ({
							...current,
							docker_compose: nextValue,
						}));
					}
					break;
				case "nginx":
					if (key === "content") {
						await onUpdateScanResults((current) => ({
							...current,
							nginx_conf: nextValue,
						}));
					}
					break;
				default:
					break;
			}
		} finally {
			setSavingFieldId(null);
		}
	}

	async function saveDraftChanges() {
		if (!selectedNode) return;
		if (selectedNode.kind === "envVars") {
			const normalized = envDraft.filter((entry) => entry.name.trim() || entry.value.trim());
			const nextValue = buildEnvVarsString(normalized);
			if (nextValue !== String(selectedNode.data?.value ?? "")) {
				await handleFieldSave(selectedNode, "value", nextValue);
			}
			return;
		}

		for (const field of BLUEPRINT_NODE_FIELDS[selectedNode.kind].filter((item) => item.editable)) {
			const original = String(selectedNode.data?.[field.key] ?? "");
			const nextValue = draftData[field.key] ?? "";
			if (original !== nextValue) {
				await handleFieldSave(selectedNode, field.key, nextValue);
			}
		}
	}

	function handleEnvFileUpload(node: BlueprintNode, event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (loadEvent) => {
			const content = String(loadEvent.target?.result ?? "");
			const parsed = parseEnvLinesToEntries(content);
			if (parsed.length === 0) {
				toast.error("No valid environment variables found in file");
				return;
			}

			const merged = new Map<string, string>();
			envDraft.forEach((entry) => {
				if (entry.name.trim()) merged.set(entry.name.trim(), entry.value);
			});
			parsed.forEach((entry) => {
				if (entry.name.trim()) merged.set(entry.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ""), entry.value);
			});

			const nextEntries = Array.from(merged.entries()).map(([name, value]) => ({ name, value }));
			const normalized = nextEntries.length > 0 ? nextEntries : [{ name: "", value: "" }];
			setEnvDraft(normalized);
			toast.success(`Imported ${parsed.length} variables from ${file.name}`);
		};
		reader.readAsText(file);
		if (envFileInputRef.current) {
			envFileInputRef.current.value = "";
		}
	}

	if (!scanResults) {
		return (
			<div className="mx-auto flex w-full max-w-7xl flex-1 p-6">
				<div className="flex min-h-[720px] w-full items-center justify-center rounded-[32px] border border-dashed border-white/10 bg-background/35">
					<div className="text-center">
						<div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10">
							<Network className="size-8 text-primary" />
						</div>
						<h2 className="mt-6 text-2xl font-semibold text-foreground">Blueprint appears after a scan</h2>
						<p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
							Run Smart Analysis or reuse existing repo files first. This view is dedicated to the deployment map, so it only lights up once the generated artifacts exist.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 select-none p-6">
				<div
					ref={canvasRef}
					className={cn(
						"relative h-full min-h-0 w-full overflow-hidden rounded-[32px] border border-white/8 bg-background/25 select-none",
						isPanning ? "cursor-grabbing" : "cursor-grab"
					)}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
					onWheel={handleWheel}
				>
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.025),transparent_28%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,34px_34px,34px_34px]" />
					<div className="absolute bottom-5 left-5 z-20 flex select-none items-center gap-1.5 rounded-full border border-white/10 bg-background/72 px-2 py-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.24)] backdrop-blur-md">
						<button
							type="button"
							onClick={() => setZoom((current) => clampZoom(current - 0.1))}
							className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
							aria-label="Zoom out"
						>
							<Minus className="size-3.5" />
						</button>
						<div className="min-w-11 text-center text-[11px] font-medium tabular-nums text-foreground/85">
							{Math.round(zoom * 100)}%
						</div>
						<button
							type="button"
							onClick={() => setZoom((current) => clampZoom(current + 0.1))}
							className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
							aria-label="Zoom in"
						>
							<Plus className="size-3.5" />
						</button>
						<div className="mx-1 h-4 w-px bg-white/10" />
						<button
							type="button"
							onClick={handleResetView}
							className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
						>
							Reset
						</button>
					</div>
					<div
						className="absolute left-0 top-0 origin-top-left select-none"
						style={{
							width: surfaceWidth,
							height: surfaceHeight,
							transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
							transformOrigin: "top left",
						}}
					>
						<div className="absolute inset-0 pointer-events-none">
							{laneSpecs.map((lane) => (
								<div
									key={lane.id}
									className="absolute rounded-[30px] border border-white/[0.04] bg-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
									style={{
										left: lane.x,
										top: lane.y,
										width: lane.width,
										height: lane.height,
									}}
								>
									<div className="px-5 pt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-white/18">
										{lane.label}
									</div>
								</div>
							))}
						</div>
						<EdgeLayer nodes={nodesWithPositions} edges={model.edges} />

						{nodesWithPositions.map((node) => {
							const styles = KIND_STYLES[node.kind];
							const Icon = styles.icon;
							const isSelected = node.id === selectedNodeId;
							const isInteractive = isInteractiveNode(node);
							const showDirtyBadge = isSelected && isInteractive && selectedNodeIsDirty;

							return (
								<button
									key={node.id}
									type="button"
									onPointerDown={(event) => {
										event.stopPropagation();
										dragMovedRef.current = false;
										setSelectedNodeId(isInteractive ? node.id : null);
										setDraggingNodeId(node.id);
										dragStartRef.current = {
											pointerX: event.clientX,
											pointerY: event.clientY,
											nodeX: node.x,
											nodeY: node.y,
										};
										const canvas = canvasRef.current;
										if (canvas && !canvas.hasPointerCapture(event.pointerId)) {
											canvas.setPointerCapture(event.pointerId);
										}
									}}
									className={cn(
										"absolute rounded-[28px] border p-0 text-left select-none",
										isSelected
											? "border-white/18 shadow-[0_24px_80px_rgba(15,23,42,0.38)]"
											: "border-white/8 shadow-[0_18px_48px_rgba(3,7,18,0.28)]",
										isInteractive ? "hover:border-white/14" : "cursor-default"
									)}
									style={{
										left: node.x,
										top: node.y,
										width: node.width ?? 220,
										height: node.height ?? 150,
									}}
								>
									<div
										className={cn(
											"h-full rounded-[28px] bg-gradient-to-br px-4 py-4 backdrop-blur-sm",
											styles.panel,
											isSelected ? "ring-1 ring-inset ring-white/10 bg-white/[0.045]" : "bg-white/[0.02]"
										)}
									>
										<div className="flex h-full flex-col">
											<div className="flex items-start justify-between gap-3">
												<div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
													<Icon className={cn("size-3.5", styles.accent)} />
													{styles.chip}
												</div>
												<div className="mt-1 flex items-center gap-2">
													{showDirtyBadge ? (
														<div className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200">
															Unsaved
														</div>
													) : null}
													{isSelected ? <div className="size-2 rounded-full bg-primary shadow-[0_0_12px_rgba(59,130,246,0.8)]" /> : null}
												</div>
											</div>
											<p className="mt-3 text-sm font-semibold leading-tight text-white">{node.title}</p>
											{node.subtitle ? <p className="mt-1 text-xs text-slate-300/75">{node.subtitle}</p> : null}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				</div>
			</div>
			<Sheet
				open={isDetailOpen}
				onOpenChange={(open) => {
					if (!open && isDirty(selectedNode)) {
						setShowUnsavedDialog(true);
						return;
					}
					setIsDetailOpen(open);
				}}
			>
				<SheetContent
					side="right"
					className="flex w-[420px] flex-col overflow-hidden border-white/10 bg-[#0b0d12]/96 text-foreground backdrop-blur-xl sm:max-w-[420px]"
				>
					{selectedNode ? (
						<>
							<SheetHeader className="pr-8">
								<div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
									{React.createElement(KIND_STYLES[selectedNode.kind].icon, {
										className: cn("size-3.5", KIND_STYLES[selectedNode.kind].accent),
									})}
									{KIND_STYLES[selectedNode.kind].chip}
								</div>
								<SheetTitle className="mt-4 text-2xl">{selectedNode.title}</SheetTitle>
								{selectedNode.subtitle ? (
									<SheetDescription className="text-sm text-muted-foreground">
										{selectedNode.subtitle}
									</SheetDescription>
								) : null}
								{selectedNodeIsDirty ? (
									<div className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">
										<div className="size-1.5 rounded-full bg-amber-300" />
										Unsaved Changes
									</div>
								) : null}
							</SheetHeader>
							<div className="mt-8 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 stealth-scrollbar">
								{selectedNode.data && Object.keys(selectedNode.data).length > 0 ? (
									<div className="space-y-2">
										<p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/65">Fields</p>
										<div className="space-y-2">
											{selectedNode.kind === "envVars" ? (
												<div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
													<div className="mb-4 flex items-center justify-between gap-3">
														<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
															Environment Variables
														</div>
														<div className="flex items-center gap-2">
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={() => envFileInputRef.current?.click()}
																className="h-8 border-white/10 bg-white/[0.03] px-3 text-[11px]"
															>
																<Upload className="mr-1.5 size-3.5" />
																Import .env
															</Button>
															<input
																ref={envFileInputRef}
																type="file"
																accept=".env,text/plain"
																className="hidden"
																onChange={(event) => handleEnvFileUpload(selectedNode, event)}
															/>
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={() => setEnvDraft((current) => [...current, { name: "", value: "" }])}
																className="h-8 border-white/10 bg-white/[0.03] px-3 text-[11px]"
															>
																<Plus className="mr-1.5 size-3.5" />
																Add Variable
															</Button>
														</div>
													</div>
													<div className="mb-2 flex flex-row gap-4 px-1">
														<span className="w-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40">Key</span>
														<span className="w-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40">Value</span>
													</div>
													<div className="space-y-2">
														{envDraft.length === 0 ? (
															<div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground/60">
																No environment variables yet.
															</div>
														) : (
															envDraft.map((entry, index) => (
																<div key={`${index}-${entry.name}`} className="flex flex-row items-center gap-2">
																	<Input
																		value={entry.name}
																		onChange={(event) => {
																			const next = [...envDraft];
																			next[index] = {
																				...next[index],
																				name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
																			};
																			setEnvDraft(next);
																		}}
																		placeholder="NAME"
																		className="h-9 bg-white/[0.03] text-xs font-mono border-white/5"
																	/>
																	<Input
																		value={entry.value}
																		onChange={(event) => {
																			const next = [...envDraft];
																			next[index] = { ...next[index], value: event.target.value };
																			setEnvDraft(next);
																		}}
																		placeholder="VALUE"
																		className="h-9 bg-white/[0.03] text-xs font-mono border-white/5"
																	/>
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon"
																		onClick={() => {
																			const next = envDraft.filter((_, currentIndex) => currentIndex !== index);
																			const normalized = next.length > 0 ? next : [{ name: "", value: "" }];
																			setEnvDraft(normalized);
																		}}
																		className="h-9 w-9 shrink-0 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive"
																	>
																		<Trash2 className="size-3.5" />
																	</Button>
																</div>
															))
														)}
													</div>
												</div>
											) : null}
											{selectedNode.kind === "customDomain" ? (
												<div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
													<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
														Custom Domain
													</div>
													<div className="relative group">
														<div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/30 transition-colors group-focus-within:text-primary/50">
															https://
														</div>
														<Input
															value={getCurrentFieldValue(selectedNode, "url")}
															placeholder="my-cool-app"
															className="h-11 rounded-xl border-white/10 bg-white/[0.02] pl-14 pr-32 text-sm font-medium text-foreground placeholder:text-muted-foreground/20"
															onChange={(event) => setDraftData((current) => ({ ...current, url: event.target.value }))}
														/>
														<div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
															<span className="font-mono text-[10px] text-muted-foreground/20">.{DOMAIN_SUFFIX}</span>
														</div>
													</div>
												</div>
											) : null}
											{BLUEPRINT_NODE_FIELDS[selectedNode.kind]
												.filter((field) => !(selectedNode.kind === "envVars" && field.key === "value"))
												.filter((field) => !(selectedNode.kind === "customDomain" && field.key === "url"))
												.filter((field) => {
													const value = selectedNode.data?.[field.key];
													return field.editable || (value !== null && value !== undefined && value !== "");
												})
												.map((field) => {
													const value = selectedNode.data?.[field.key];
													const fieldId = `${selectedNode.id}:${field.key}`;
													const disabled = savingFieldId === fieldId;

													return (
														<div key={field.key} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
															<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
																{field.label}
															</div>
															{field.editable ? (
																field.type === "textarea" ? (
																	<Textarea
																		value={getCurrentFieldValue(selectedNode, field.key)}
																		disabled={disabled}
																		placeholder={field.placeholder}
																		className="min-h-28 rounded-xl border-white/10 bg-white/[0.02] text-sm text-foreground"
																		onChange={(event) => setDraftData((current) => ({ ...current, [field.key]: event.target.value }))}
																	/>
																) : field.type === "select" ? (
																	<Select
																		value={getCurrentFieldValue(selectedNode, field.key)}
																		onValueChange={(next) => setDraftData((current) => ({ ...current, [field.key]: next }))}
																		disabled={disabled}
																	>
																		<SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.02] text-sm text-foreground">
																			<SelectValue placeholder={field.placeholder || field.label} />
																		</SelectTrigger>
																		<SelectContent>
																			{getFieldOptions(selectedNode, field.key).map((option) => (
																				<SelectItem key={option.value} value={option.value}>
																					{option.label}
																				</SelectItem>
																			))}
																		</SelectContent>
																	</Select>
																) : (
																	<Input
																		type={field.type === "number" ? "number" : "text"}
																		value={getCurrentFieldValue(selectedNode, field.key)}
																		disabled={disabled}
																		placeholder={field.placeholder}
																		className="h-11 rounded-xl border-white/10 bg-white/[0.02] text-sm text-foreground"
																		onChange={(event) => setDraftData((current) => ({ ...current, [field.key]: event.target.value }))}
																	/>
																)
															) : (
																<div className="text-sm text-foreground/90">
																	{formatFieldValue(value)}
																</div>
															)}
														</div>
													);
												})}
										</div>
									</div>
								) : null}
							</div>
						</>
					) : null}
				</SheetContent>
			</Sheet>
			<AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
				<AlertDialogContent className="border-white/8 bg-[#0b0d12] text-foreground">
					<AlertDialogHeader>
						<AlertDialogTitle>Save changes?</AlertDialogTitle>
						<AlertDialogDescription>
							This sheet has unsaved changes. You can save them before closing or discard them.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setShowUnsavedDialog(false)}
							className="text-muted-foreground"
						>
							Keep Editing
						</Button>
						<AlertDialogCancel
							onClick={() => {
								setShowUnsavedDialog(false);
								resetDrafts(selectedNode);
								setIsDetailOpen(false);
							}}
							className="border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
						>
							Discard
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={async () => {
								await saveDraftChanges();
								setShowUnsavedDialog(false);
								setIsDetailOpen(false);
							}}
							className="bg-primary text-primary-foreground hover:bg-primary/90"
						>
							Save
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

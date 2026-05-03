import { useMemo, useState } from "react";
import { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle, TerminalSquare, Copy, Settings, CheckCircle2, Clock, Database, Layers, Edit2, Save, Lock, Globe, Trash2, Download, RefreshCw, FolderGit2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
	canonicalDockerfileDeployPath,
	isValidRepoRelativeDockerfilePath,
	syncDockerfilePathInCompose,
} from "@/lib/dockerfileDeployPath";

type AddFileType = "dockerfile" | "compose";

type PostScanResultsProps = {
	results: SDArtifactsResponse;
	deployment: DeployConfig;
	packagePath?: string;
	scanTime?: number;
	onStartDeployment: () => void;
	onCancel: () => void;
	onUpdateResults?: (results: SDArtifactsResponse) => void;
	onStartImproveScan?: (payload: {
		repoUrl: string;
		commitSha?: string;
		packagePath?: string;
		feedback: string;
		failedArtifactScope?: string;
	}) => void;
};

export default function PostScanResults({ results, packagePath, scanTime, deployment, onCancel, onUpdateResults, onStartImproveScan }: PostScanResultsProps) {
	const dockerfileNames = useMemo(() => {
		if (!results.dockerfiles) return [];
		return Object.keys(results.dockerfiles).sort((a, b) =>
			canonicalDockerfileDeployPath(a).localeCompare(canonicalDockerfileDeployPath(b), undefined, { sensitivity: "base" }),
		);
	}, [results.dockerfiles]);

	const deploymentIdShort = useMemo(() => {
		const raw = (deployment as any)?.id;
		if (raw === null || raw === undefined) return "—";
		return String(raw).substring(0, 12);
	}, [deployment]);

	const initialActiveTab = dockerfileNames[0] ?? "";
	const [activeTab, setActiveTab] = useState<string>(initialActiveTab);
	const [isEditing, setIsEditing] = useState(false);
	const [editContent, setEditContent] = useState("");
	const [deployPathDraft, setDeployPathDraft] = useState("");
	const [improveDialogOpen, setImproveDialogOpen] = useState(false);
	const [addFileDialogOpen, setAddFileDialogOpen] = useState(false);
	const [addFileType, setAddFileType] = useState<AddFileType>("dockerfile");
	const [addFilePath, setAddFilePath] = useState("");
	const [addFileContent, setAddFileContent] = useState("");
	const [userFeedback, setUserFeedback] = useState("");
	const [serviceDrafts, setServiceDrafts] = useState<Array<{ build_context: string; port: string }>>([]);
	const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);

	const selectedTab = useMemo(() => {
		if (activeTab === "compose" || activeTab === "nginx") return activeTab;
		if (dockerfileNames.includes(activeTab)) return activeTab;
		return initialActiveTab;
	}, [activeTab, dockerfileNames, initialActiveTab]);

	const isDockerfileTab = dockerfileNames.includes(selectedTab);
	const isInfraFileTab = isDockerfileTab || selectedTab === "compose" || selectedTab === "nginx";

	const isEditingCurrentTab = isEditing && selectedTab === activeTab;
	const deployPathValue = useMemo(() => {
		if (!isDockerfileTab) return "";
		return deployPathDraft || canonicalDockerfileDeployPath(selectedTab);
	}, [deployPathDraft, isDockerfileTab, selectedTab]);

	const serviceDraftSeed = useMemo(
		() =>
			(results.services || []).map((svc) => ({
				build_context: svc.build_context || ".",
				port: String(svc.port || 8080),
			})),
		[results.services]
	);

	const effectiveServiceDrafts = serviceDrafts.length === serviceDraftSeed.length ? serviceDrafts : serviceDraftSeed;

	const selectTab = (nextTab: string) => {
		setActiveTab(nextTab);
		setIsEditing(false);
		setEditContent("");
		if (nextTab === "compose" || nextTab === "nginx") {
			setDeployPathDraft("");
		} else {
			setDeployPathDraft(canonicalDockerfileDeployPath(nextTab));
		}
	};

	const handleEdit = () => {
		if (!isInfraFileTab) {
			toast.info("This tab is read-only.");
			return;
		}

		let content = "";
		if (selectedTab === "compose") content = results.docker_compose || "";
		else if (selectedTab === "nginx") content = results.nginx_conf || "";
		else content = results.dockerfiles?.[selectedTab] || "";

		setEditContent(content);
		setIsEditing(true);
	};

	const handleSave = () => {
		if (!onUpdateResults) return;
		if (!isInfraFileTab) return;

		const updatedResults = { ...results };
		if (selectedTab === "compose") {
			updatedResults.docker_compose = editContent;
		} else if (selectedTab === "nginx") {
			updatedResults.nginx_conf = editContent;
		} else {
			if (!updatedResults.dockerfiles) updatedResults.dockerfiles = {};
			updatedResults.dockerfiles[selectedTab] = editContent;
		}

		onUpdateResults(updatedResults);
		setIsEditing(false);
		toast.success("File changes saved successfully");
	};

	const handleDelete = () => {
		if (!onUpdateResults) return;
		if (!isInfraFileTab) {
			toast.info("This tab is read-only.");
			return;
		}
		if (selectedTab !== "compose" && selectedTab !== "nginx" && dockerfileNames.length <= 1) {
			toast.error("At least one Dockerfile is required. Add another Dockerfile before deleting this one.");
			return;
		}

		const updatedResults = { ...results };
		let nextTab = "";

		if (selectedTab === "compose") {
			updatedResults.docker_compose = "";
		} else if (selectedTab === "nginx") {
			updatedResults.nginx_conf = "";
		} else {
			if (updatedResults.dockerfiles) {
				delete updatedResults.dockerfiles[selectedTab];
			}
		}

		// Find next available tab
		const remainingDockerfiles = Object.keys(updatedResults.dockerfiles || {});
		if (remainingDockerfiles.length > 0) {
			nextTab = remainingDockerfiles[0];
		} else if (updatedResults.docker_compose) {
			nextTab = "compose";
		} else if (updatedResults.nginx_conf) {
			nextTab = "nginx";
		}

		onUpdateResults(updatedResults);
		selectTab(nextTab);
		toast.success("File deleted successfully");
	};

	const resetAddFileForm = () => {
		setAddFileType("dockerfile");
		setAddFilePath("");
		setAddFileContent("");
	};

	const handleAddFile = () => {
		if (!onUpdateResults) return;

		const updatedResults: SDArtifactsResponse = {
			...results,
			dockerfiles: { ...(results.dockerfiles || {}) },
		};

		if (addFileType === "compose") {
			if (results.docker_compose?.trim()) {
				toast.error("A compose file already exists. Delete it first if you want to replace it.");
				return;
			}

			updatedResults.docker_compose = addFileContent;
			onUpdateResults(updatedResults);
			selectTab("compose");
			setAddFileDialogOpen(false);
			resetAddFileForm();
			toast.success("Compose file added successfully");
			return;
		}

		const rawPath = addFilePath.trim();
		if (!isValidRepoRelativeDockerfilePath(rawPath)) {
			toast.error("Invalid Dockerfile path: use a repo-relative path like client/Dockerfile.");
			return;
		}

		const dockerfilePath = canonicalDockerfileDeployPath(rawPath);
		if (updatedResults.dockerfiles[dockerfilePath] !== undefined) {
			toast.error(`A Dockerfile already exists at ${dockerfilePath}.`);
			return;
		}

		updatedResults.dockerfiles[dockerfilePath] = addFileContent;
		onUpdateResults(updatedResults);
		selectTab(dockerfilePath);
		setAddFileDialogOpen(false);
		resetAddFileForm();
		toast.success("Dockerfile added successfully");
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		toast.success("Copied to clipboard");
	};

	const handleUpdateDeployPath = () => {
		if (!onUpdateResults) return;
		if (!isDockerfileTab) return;

		const raw = deployPathDraft.trim();
		if (!isValidRepoRelativeDockerfilePath(raw)) {
			toast.error("Invalid path: use a repo-relative path (e.g. client/Dockerfile). No .. or absolute paths.");
			return;
		}

		const newKey = canonicalDockerfileDeployPath(raw);
		const oldKey = selectedTab;
		if (newKey === oldKey) {
			toast.message("Deploy path already matches this Dockerfile.");
			return;
		}

		const content = results.dockerfiles?.[oldKey];
		if (content === undefined) return;

		if (results.dockerfiles?.[newKey] !== undefined) {
			toast.error(`Another Dockerfile already uses ${newKey}. Remove or rename it first.`);
			return;
		}

		const updated: SDArtifactsResponse = {
			...results,
			dockerfiles: { ...results.dockerfiles },
		};

		delete updated.dockerfiles![oldKey];
		updated.dockerfiles![newKey] = content;

		if (results.hadolint_results?.[oldKey]) {
			updated.hadolint_results = { ...results.hadolint_results };
			const h = updated.hadolint_results[oldKey];
			delete updated.hadolint_results[oldKey];
			updated.hadolint_results[newKey] = h;
		}

		if (results.services?.length) {
			const oldCanon = canonicalDockerfileDeployPath(oldKey);
			updated.services = results.services.map((s) => {
				if (s.dockerfile_path === oldKey || canonicalDockerfileDeployPath(s.dockerfile_path) === oldCanon) {
					return { ...s, dockerfile_path: newKey };
				}
				return s;
			});
		}

		if (results.docker_compose) {
			updated.docker_compose = syncDockerfilePathInCompose(results.docker_compose, oldKey, newKey);
		}

		onUpdateResults(updated);
		selectTab(newKey);
		toast.success("Deploy path updated; this path is used when writing files on the server.");
	};

	const handleServiceDraftChange = (index: number, field: "build_context" | "port", value: string) => {
		setServiceDrafts((prev) => {
			const base = prev.length === serviceDraftSeed.length ? prev : serviceDraftSeed;
			return base.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft));
		});
	};

	const handleSaveServiceSettings = (index: number) => {
		if (!onUpdateResults || !results.services?.[index]) return;
		const draft = effectiveServiceDrafts[index];
		if (!draft) return;

		const nextBuildContext = draft.build_context.trim() || ".";
		const parsedPort = Number.parseInt(draft.port, 10);
		if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
			toast.error("Port must be a number between 1 and 65535.");
			return;
		}

		const current = results.services[index];
		if (current.build_context === nextBuildContext && current.port === parsedPort) {
			return;
		}

		const updated: SDArtifactsResponse = {
			...results,
			services: results.services.map((svc, i) =>
				i === index ? { ...svc, build_context: nextBuildContext, port: parsedPort } : svc
			),
		};
		onUpdateResults(updated);
		setEditingServiceIndex(null);
		toast.success(`Updated ${current.name} settings`);
	};

	function buildTemplateFeedback(r: SDArtifactsResponse): string {
		const confidence = Math.round((r.confidence ?? 0) * 100);
		const hadolintCount = Object.values(r.hadolint_results || {}).reduce((acc, curr) => {
			if (!curr) return acc;
			if (typeof curr === "string") return acc + curr.split("\n").filter(Boolean).length;
			if (Array.isArray(curr)) return acc + curr.length;
			if (typeof curr === "object") {
				const issueCount = (curr as { issues?: unknown[] }).issues;
				return acc + (Array.isArray(issueCount) ? issueCount.length : 1);
			}
			return acc + 1;
		}, 0);
		const riskCount = (r.risks && r.risks.length) || 0;
		const serviceNames = (r.services || []).map((s) => s.name).join(", ") || "none";
		const parts = [
			`Current scan: ${confidence}% confidence, ${hadolintCount} hadolint issue(s), ${riskCount} risk(s).`,
			`Services: ${serviceNames}.`,
			r.stack_summary ? `Stack: ${r.stack_summary}` : "",
			"Please improve Dockerfiles, nginx, and compose where needed.",
		].filter(Boolean);
		return parts.join(" ");
	}

	function handleImproveScanResults() {
		if (!deployment?.url || !onStartImproveScan) return;
		const template = buildTemplateFeedback(results);
		const feedback = userFeedback.trim() ? `${template}\n\nAdditional feedback: ${userFeedback.trim()}` : template;
		const failedArtifactScope =
			selectedTab === "compose" ? "compose" :
				selectedTab === "nginx" ? "nginx" :
					selectedTab ? "dockerfile" : "general";
		onStartImproveScan({
			repoUrl: deployment.url,
			commitSha: (results.commit_sha || deployment.commitSha) ?? undefined,
			packagePath,
			feedback,
			failedArtifactScope,
		});
		setImproveDialogOpen(false);
		setUserFeedback("");
	}

	const hasRisks = results.risks && results.risks.length > 0;
	const commandRows = useMemo(() => flattenCommandRows(results.commands), [results.commands]);
	const groupedCommandRows = useMemo(() => {
		const grouped: Record<string, Array<{ label: string; command: string }>> = {};
		for (const row of commandRows) {
			if (!grouped[row.group]) grouped[row.group] = [];
			grouped[row.group].push({ label: row.label, command: row.command });
		}
		return grouped;
	}, [commandRows]);
	const commandCount = commandRows.length;
	const commandGroupNames = Object.keys(groupedCommandRows);
	const stackTokens = results.stack_tokens || [];
	const dockerfileCount = Object.keys(results.dockerfiles || {}).length;
	const responseId = results.response_id || "n/a";
	const selectedTabCopyText = useMemo(() => {
		if (isDockerfileTab) return results.dockerfiles?.[selectedTab] || "";
		if (selectedTab === "compose") return results.docker_compose || "";
		if (selectedTab === "nginx") return results.nginx_conf || "";
		return "";
	}, [
		isDockerfileTab,
		results.docker_compose,
		results.dockerfiles,
		results.nginx_conf,
		selectedTab,
	]);
	const fullPayloadJson = useMemo(() => {
		try {
			return JSON.stringify(results, null, 2);
		} catch {
			return String(results);
		}
	}, [results]);

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
			{/* Header Section */}
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10 pb-6 border-b border-white/5">
				<div>
					<div className="flex items-center gap-3 mb-3">
						<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold tracking-widest uppercase text-emerald-400">
							<CheckCircle2 className="size-3" />
							Analysis Complete
						</div>
						<span className="text-[10px] text-muted-foreground/40 font-mono tracking-tighter uppercase">Deployment ID: {deploymentIdShort}</span>
					</div>
					<h2 className="text-4xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/40">
						Post-Scan Results
					</h2>
					<p className="text-muted-foreground/60 mt-2 flex items-center gap-2 text-sm">
						Repository: <span className="text-primary font-mono font-medium hover:underline cursor-pointer">{deployment.repoName}{deployment.serviceName != "." ? "/" + deployment.serviceName : ""}</span>
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Button variant="ghost" onClick={onCancel} className="text-xs font-bold text-muted-foreground hover:text-white transition-colors uppercase tracking-widest px-4 h-10">
						Reject Analysis
					</Button>
					{onStartImproveScan && (
						<Button
							variant="outline"
							onClick={() => setImproveDialogOpen(true)}
							className="h-10 px-4 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30 transition-all active:scale-95 uppercase tracking-widest font-bold text-[10px]"
						>
							<RefreshCw className="size-3.5 mr-2" />
							Improve Scan Results
						</Button>
					)}
					<div className="w-px h-4 bg-white/10" />
					<Button variant="outline" className="h-10 px-4 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30 transition-all active:scale-95 uppercase tracking-widest font-bold text-[10px]">
						<Download className="size-3.5 mr-2" />
						Full JSON Export
					</Button>
				</div>
			</div>

			<AlertDialog open={improveDialogOpen} onOpenChange={setImproveDialogOpen}>
				<AlertDialogContent className="bg-[#0a0a0f] border-white/5 max-w-md shadow-2xl backdrop-blur-xl">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-xl font-bold text-white tracking-tight">
							Improve Scan Results
						</AlertDialogTitle>
						<AlertDialogDescription className="text-muted-foreground/80 text-sm leading-relaxed text-left">
							We&apos;ll send the current scan summary (confidence, lint issues, risks) to generate improved Dockerfiles, nginx, and compose. Optionally add details below.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="py-3">
						<label htmlFor="improve-feedback" className="text-xs font-medium text-muted-foreground block mb-2">
							Anything specific to improve? (optional)
						</label>
						<Textarea
							id="improve-feedback"
							placeholder="e.g. Fix /api routing in nginx, add health checks..."
							value={userFeedback}
							onChange={(e) => setUserFeedback(e.target.value)}
							className="min-h-24 resize-y bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground/50"
						/>
					</div>
					<AlertDialogFooter className="mt-4 gap-3 flex flex-row items-center justify-end">
						<AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-white h-10 px-4 rounded-lg font-medium m-0">
							Cancel
						</AlertDialogCancel>
						<Button
							onClick={() => handleImproveScanResults()}
							disabled={!onStartImproveScan}
							className="h-10 px-6 rounded-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg flex items-center gap-2"
						>
							<RefreshCw className="size-4" />
							Improve
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={addFileDialogOpen}
				onOpenChange={(open) => {
					setAddFileDialogOpen(open);
					if (!open) resetAddFileForm();
				}}
			>
				<AlertDialogContent className="bg-[#0a0a0f] border-white/5 max-w-lg shadow-2xl backdrop-blur-xl">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-xl font-bold text-white tracking-tight">
							Add Infrastructure File
						</AlertDialogTitle>
						<AlertDialogDescription className="text-muted-foreground/80 text-sm leading-relaxed text-left">
							Choose whether the new file is a Dockerfile or a compose file so SmartDeploy can store and use it correctly.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="py-3 space-y-4">
						<div>
							<p className="text-xs font-medium text-muted-foreground block mb-2">File type</p>
							<div className="grid grid-cols-2 gap-2">
								<Button
									type="button"
									variant={addFileType === "dockerfile" ? "default" : "outline"}
									className={addFileType === "dockerfile" ? "justify-start" : "justify-start border-white/10 bg-white/5 hover:bg-white/10 text-white"}
									onClick={() => setAddFileType("dockerfile")}
								>
									Dockerfile
								</Button>
								<Button
									type="button"
									variant={addFileType === "compose" ? "default" : "outline"}
									className={addFileType === "compose" ? "justify-start" : "justify-start border-white/10 bg-white/5 hover:bg-white/10 text-white"}
									onClick={() => setAddFileType("compose")}
								>
									Compose
								</Button>
							</div>
						</div>

						{addFileType === "dockerfile" ? (
							<div>
								<label htmlFor="new-dockerfile-path" className="text-xs font-medium text-muted-foreground block mb-2">
									Dockerfile path
								</label>
								<Input
									id="new-dockerfile-path"
									placeholder="client/Dockerfile"
									value={addFilePath}
									onChange={(e) => setAddFilePath(e.target.value)}
									className="font-mono bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground/50"
									spellCheck={false}
									autoComplete="off"
								/>
							</div>
						) : (
							<div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
								<p className="text-xs text-muted-foreground/80">
									Compose files are stored as <span className="font-mono text-white/70">docker-compose.yml</span>.
								</p>
							</div>
						)}

						<div>
							<label htmlFor="new-file-content" className="text-xs font-medium text-muted-foreground block mb-2">
								File content
							</label>
							<Textarea
								id="new-file-content"
								placeholder={addFileType === "compose" ? "services:\n  app:\n    build: ." : "FROM node:20-alpine"}
								value={addFileContent}
								onChange={(e) => setAddFileContent(e.target.value)}
								className="min-h-40 resize-y bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground/50 font-mono"
								spellCheck={false}
							/>
						</div>
					</div>
					<AlertDialogFooter className="mt-4 gap-3 flex flex-row items-center justify-end">
						<AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-white h-10 px-4 rounded-lg font-medium m-0">
							Cancel
						</AlertDialogCancel>
						<Button
							onClick={handleAddFile}
							disabled={!onUpdateResults || !addFileContent.trim() || (addFileType === "dockerfile" && !addFilePath.trim())}
							className="h-10 px-6 rounded-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg flex items-center gap-2"
						>
							<Plus className="size-4" />
							Add file
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Scan Summary */}
			<Card className="mb-8 border-white/10 bg-white/[0.02] rounded-2xl">
				<div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
					<div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
						<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">confidence</p>
						<p className="text-sm font-bold text-white">{Math.round((results.confidence || 0) * 100)}%</p>
					</div>
					<div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
						<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">services</p>
						<p className="text-sm font-bold text-white">{results.services?.length || 0}</p>
					</div>
					<div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
						<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">risks</p>
						<p className="text-sm font-bold text-white">{results.risks?.length || 0}</p>
					</div>
					<div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
						<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">commands</p>
						<p className="text-sm font-bold text-white">{commandCount}</p>
					</div>
					<div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
						<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">dockerfiles</p>
						<p className="text-sm font-bold text-white">{dockerfileCount}</p>
					</div>
				</div>
			</Card>

			<div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:h-[850px]">
				{/* Left Sidebar Info */}
				<div className="col-span-1 lg:col-span-4 flex flex-col gap-10 h-full overflow-hidden pb-4">
					{/* Tech Stack Segment */}
					<section className="space-y-5">
						<div className="flex items-center gap-2 px-1">
							<div className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(37,244,106,0.8)]" />
							<h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">Tech Stack</h3>
						</div>
						<div className="flex flex-wrap gap-2.5">
							{results.stack_summary.split(' ').filter(w => w.length > 2 && !['app', 'with', 'server', 'application'].includes(w.toLowerCase())).map((tech, i) => (
								<div key={i} className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center gap-2 group hover:border-primary/30 transition-colors">
									<div className="size-1.5 rounded-sm bg-white/20 group-hover:bg-primary transition-colors" />
									<span className="text-xs font-medium text-white/80 group-hover:text-white">{tech}</span>
								</div>
							))}
						</div>
					</section>

					{/* Scan Metadata Segment */}
					<section className="space-y-5">
						<div className="flex items-center gap-2 px-1">
							<div className="size-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
							<h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">Scan Metadata</h3>
						</div>
						<div className="grid grid-cols-2 gap-2.5">
							<div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
								<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">response_id</p>
								<p className="mt-1 text-[11px] font-mono text-white/85 break-all">{responseId}</p>
							</div>
							<div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
								<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">commit_sha</p>
								<p className="mt-1 text-[11px] font-mono text-white/85 break-all">{results.commit_sha || "n/a"}</p>
							</div>
							<div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
								<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">counts</p>
								<p className="mt-1 text-[11px] font-mono text-white/85">
									svc={results.services?.length || 0} df={dockerfileCount}
								</p>
							</div>
							<div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
								<p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">existing</p>
								<p className="mt-1 text-[11px] font-mono text-white/85">
									docker={String(Boolean(results.has_existing_dockerfiles))} compose={String(Boolean(results.has_existing_compose))}
								</p>
							</div>
						</div>
						{stackTokens.length > 0 && (
							<div className="flex flex-wrap gap-2">
								{stackTokens.map((token) => (
									<span key={token} className="px-2 py-1 rounded-md border border-white/10 bg-white/[0.02] text-[10px] font-mono text-white/80">
										{token}
									</span>
								))}
							</div>
						)}
					</section>

					{/* Services Segment */}
					<section className="space-y-5">
						<div className="flex items-center gap-2 px-1">
							<div className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(37,244,106,0.8)]" />
							<h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">Detected Services</h3>
						</div>
						<div className="grid gap-3">
							{results.services?.map((svc, i) => (
								<div
									key={i}
									className="group relative"
									onDoubleClick={() => {
										if (!onUpdateResults) return;
										setEditingServiceIndex(i);
									}}
								>
									<div className="absolute inset-0 bg-primary/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
									<div className="relative p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 group-hover:border-primary/20 transition-all">
										{onUpdateResults && editingServiceIndex !== i && (
											<Button
												type="button"
												size="icon"
												variant="ghost"
												className="absolute right-3 top-3 h-7 w-7 text-muted-foreground/60 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
												onClick={() => setEditingServiceIndex(i)}
											>
												<Edit2 className="size-3.5" />
											</Button>
										)}
										<div className="flex items-center gap-4 flex-1 min-w-0">
											<div className="size-10 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center p-2 group-hover:bg-primary/10 group-hover:border-primary/20 transition-colors">
												{svc.name.includes('web') ? <Settings className="size-5 text-muted-foreground group-hover:text-primary" /> : <Database className="size-5 text-muted-foreground group-hover:text-primary" />}
											</div>
											<div className="min-w-0">
												<p className="font-bold text-white text-sm tracking-tight">{svc.name}</p>
												<p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5">{svc.dockerfile_path}</p>
												{editingServiceIndex === i && onUpdateResults ? (
													<div className="mt-2.5 flex flex-wrap items-end gap-2">
														<div className="min-w-[150px]">
															<p className="text-[10px] text-muted-foreground/50 font-semibold uppercase tracking-wide mb-1">ctx</p>
															<Input
																value={effectiveServiceDrafts[i]?.build_context ?? svc.build_context ?? "."}
																onChange={(e) => handleServiceDraftChange(i, "build_context", e.target.value)}
																placeholder="."
																spellCheck={false}
																autoComplete="off"
																className="h-8 text-[11px] font-mono bg-white/[0.04] border-white/10 text-white/90"
															/>
														</div>
														<div className="w-24">
															<p className="text-[10px] text-muted-foreground/50 font-semibold uppercase tracking-wide mb-1">port</p>
															<Input
																type="number"
																min={1}
																max={65535}
																value={effectiveServiceDrafts[i]?.port ?? String(svc.port || 8080)}
																onChange={(e) => handleServiceDraftChange(i, "port", e.target.value)}
																className="h-8 text-[11px] font-mono bg-white/[0.04] border-white/10 text-white/90"
															/>
														</div>
														<Button
															type="button"
															size="sm"
															variant="secondary"
															className="h-8 px-3 text-[10px] uppercase tracking-wide bg-white/10 hover:bg-white/15 text-white border-white/10"
															onClick={() => handleSaveServiceSettings(i)}
														>
															Save
														</Button>
														<Button
															type="button"
															size="sm"
															variant="ghost"
															className="h-8 px-3 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-white"
															onClick={() => setEditingServiceIndex(null)}
														>
															Cancel
														</Button>
													</div>
												) : (
													<>
														<p className="text-[10px] text-muted-foreground/45 font-mono mt-0.5">ctx: {svc.build_context || "."}</p>
														<p className="text-[10px] text-muted-foreground/45 font-mono mt-0.5">port: {svc.port || "Auto"}</p>
													</>
												)}
											</div>
										</div>
										{editingServiceIndex !== i && (
											<div className="text-right shrink-0 pl-2">
												<span className="text-[10px] font-black text-white/20 group-hover:text-primary/50 tracking-tighter uppercase transition-colors">Port</span>
												<p className="text-xs font-bold text-white/60 group-hover:text-white transition-colors">{svc.port || 'Auto'}</p>
											</div>
										)}
									</div>
								</div>
							))}
						</div>
					</section>

					{/* Deployment Risks Segment - Now the scrollable part of the sidebar if content overflows */}
					<section className="space-y-5 flex-1 min-h-0 flex flex-col">
						<div className="flex items-center gap-2 px-1">
							<div className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
							<h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">Security & Risks</h3>
						</div>
						<div className="space-y-3 overflow-y-auto pr-1 flex-1 stealth-scrollbar transition-colors">
							{hasRisks ? (
								results.risks.map((risk, i) => (
									<div key={i} style={{ wordBreak: 'break-word' }} className="p-4 rounded-xl border border-amber-500/10 bg-amber-500/5 text-sm text-white/70 leading-relaxed flex gap-3 group hover:bg-amber-500/10 transition-colors">
										<AlertTriangle className="size-4 text-amber-500 shrink-0" />
										<p>{risk}</p>
									</div>
								))
							) : (
								<div className="p-5 rounded-xl border border-emerald-500/10 bg-emerald-500/5 flex items-center gap-3">
									<div className="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
										<CheckCircle2 className="size-4 text-emerald-500" />
									</div>
									<span className="text-xs font-medium text-emerald-500/80">Everything looks optimized for deployment.</span>
								</div>
							)}
						</div>
					</section>
				</div>

				{/* Right Main Content (File Viewer) */}
				<div className="col-span-1 lg:col-span-8 flex flex-col h-full min-h-0">
					<div className="flex items-center justify-between mb-5 px-1 shrink-0">
						<div className="flex items-center gap-3">
							<div className="p-1.5 bg-primary/10 rounded-lg border border-primary/20">
								<TerminalSquare className="size-4 text-primary" />
							</div>
							<h3 className="text-sm font-bold text-white tracking-tight uppercase tracking-wider">Infrastructure Sandbox</h3>
						</div>
						<div className="flex items-center gap-2">
							{isEditing ? (
								<Button size="sm" className="h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white border-0 px-4 transition-all" onClick={handleSave}>
									<Save className="size-3.5 mr-2" />
									Push Changes
								</Button>
							) : (
								<div className="flex items-center gap-2">
									<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-white hover:bg-white/5 rounded-lg" onClick={() => setAddFileDialogOpen(true)}>
										<Plus className="size-3.5 mr-2" />
										Add File
									</Button>
									{isInfraFileTab && (
										<>
											<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-white hover:bg-white/5 rounded-lg" onClick={handleEdit}>
												<Edit2 className="size-3.5 mr-2" />
												Modify File
											</Button>
											<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg" onClick={handleDelete}>
												<Trash2 className="size-3.5 mr-2" />
												Delete
											</Button>
										</>
									)}
								</div>
							)}
							<div className="w-px h-4 bg-white/10 mx-1" />
							<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-white hover:bg-white/5 rounded-lg" onClick={() => copyToClipboard(selectedTabCopyText)}>
								<Copy className="size-3.5 mr-2" />
								Copy
							</Button>
						</div>
					</div>

					{isDockerfileTab && (
						<div className="flex flex-wrap items-end gap-3 mb-4 px-1">
							<div className="flex-1 min-w-[min(100%,220px)]">
								<label htmlFor="deploy-dockerfile-path" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5 mb-1.5">
									<FolderGit2 className="size-3 opacity-70" />
									Deploy path (repo-relative)
								</label>
								<Input
									id="deploy-dockerfile-path"
									value={deployPathValue}
									onChange={(e) => setDeployPathDraft(e.target.value)}
									className="font-mono text-xs h-9 bg-white/[0.04] border-white/10 text-white/90 placeholder:text-muted-foreground/40"
									placeholder="client/Dockerfile"
									spellCheck={false}
									autoComplete="off"
								/>
								<p className="text-[10px] text-muted-foreground/50 mt-1.5 leading-snug">
									This path is the object key in scan results and on EC2 (e.g. <span className="font-mono text-white/60">client/Dockerfile</span>). Folder-only names get <span className="font-mono text-white/60">/Dockerfile</span> appended on deploy unless you include a Dockerfile filename.
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								variant="secondary"
								className="h-9 shrink-0 bg-white/10 hover:bg-white/15 text-white border-white/10"
								onClick={handleUpdateDeployPath}
								disabled={!onUpdateResults}
							>
								Update path
							</Button>
						</div>
					)}

					<Card className="flex-1 flex flex-col bg-[#050505] border-white/5 shadow-2xl rounded-2xl overflow-hidden min-h-0">
						{/* IDE Tabs */}
						<div className="flex items-center bg-[#0a0a0a] border-b border-white/5 h-11 px-2.5 gap-1 overflow-x-auto no-scrollbar shrink-0">
							{dockerfileNames.map((name) => {
								const tabLabel = canonicalDockerfileDeployPath(name);
								const isActive = selectedTab === name;
								return (
									<button
										key={name}
										type="button"
										title={tabLabel}
										onClick={() => selectTab(name)}
										className={`relative flex items-center gap-2 px-3 h-8 text-[11px] font-mono font-semibold tracking-tight rounded-md transition-all whitespace-nowrap max-w-[min(100%,280px)] truncate ${isActive ? 'bg-white/5 text-primary shadow-sm' : 'text-muted-foreground/60 hover:text-white hover:bg-white/[0.03]'}`}
									>
										{isActive && <div className="absolute bottom-1 left-3 right-3 h-0.5 bg-primary rounded-full" />}
										<div className={`size-1.5 rounded-full shrink-0 ${isActive ? 'bg-primary shadow-[0_0_8px_rgba(37,244,106,1)]' : 'bg-white/20'}`} />
										<span className="truncate">{tabLabel}</span>
									</button>
								);
							})}
							{(results.docker_compose || results.nginx_conf) && <div className="w-px h-4 bg-white/10 mx-2" />}
							{results.docker_compose && (
								<button
									onClick={() => selectTab("compose")}
									className={`relative flex items-center gap-2 px-4 h-8 text-[11px] font-bold rounded-md transition-all ${selectedTab === 'compose' ? 'bg-white/5 text-primary' : 'text-muted-foreground/60 hover:text-white'}`}
								>
									{selectedTab === 'compose' && <div className="absolute bottom-1 left-4 right-4 h-0.5 bg-primary rounded-full" />}
									<Layers className="size-3.5" />
									docker-compose.yml
								</button>
							)}
							{results.nginx_conf && (
								<button
									onClick={() => selectTab("nginx")}
									className={`relative flex items-center gap-2 px-4 h-8 text-[11px] font-bold rounded-md transition-all ${selectedTab === 'nginx' ? 'bg-white/5 text-primary' : 'text-muted-foreground/60 hover:text-white'}`}
								>
									{selectedTab === 'nginx' && <div className="absolute bottom-1 left-4 right-4 h-0.5 bg-primary rounded-full" />}
									<Globe className="size-3.5" />
									nginx.conf
								</button>
							)}
						</div>

						{/* Code Content */}
						<div className="relative overflow-y-auto flex-1 flex flex-col group/code stealth-scrollbar">
							{isEditingCurrentTab ? (
								<textarea
									value={editContent}
									onChange={(e) => setEditContent(e.target.value)}
									className="flex-1 w-full bg-transparent border-none outline-none p-6 font-mono text-sm text-white/70 resize-none stealth-scrollbar leading-[1.6] selection:bg-primary/20"
									spellCheck="false"
								/>
							) : (
								<div className="flex-1 p-6 font-mono text-[13px] text-white/80 overflow-y-auto whitespace-pre-wrap leading-[1.7] stealth-scrollbar selection:bg-primary/20 bg-grid-white/[0.02]">
									{isDockerfileTab && (
										results.dockerfiles && results.dockerfiles[selectedTab] ? (
											<div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.dockerfiles[selectedTab]) }} />
										) : <span className="text-white/20 italic">No instructions generated for this module.</span>
									)}
									{selectedTab === "compose" && (
										results.docker_compose ? <div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.docker_compose) }} /> : <span className="text-white/20 italic">No docker-compose.yml generated.</span>
									)}
									{selectedTab === "nginx" && (
										results.nginx_conf ? <div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.nginx_conf) }} /> : <span className="text-white/20 italic">No nginx.conf generated.</span>
									)}
								</div>
							)}
							{/* Floating Line Indicator */}
							{!isEditingCurrentTab && (
								<div className="absolute bottom-6 right-6 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 backdrop-blur-md opacity-0 group-hover/code:opacity-100 transition-opacity">
									<span className="text-[10px] font-mono text-muted-foreground tracking-tighter uppercase whitespace-nowrap">Mode: PROD-READY</span>
								</div>
							)}
						</div>
						{isInfraFileTab && (
							<div className="border-t border-white/5 bg-[#080808] px-4 py-3 max-h-52 overflow-y-auto stealth-scrollbar">
								<div className="flex items-center justify-between gap-2 mb-2">
									<p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Execution Commands</p>
									<span className="text-[10px] font-mono text-white/60">{commandCount}</span>
								</div>
								{commandCount > 0 ? (
									<div className="space-y-2">
										{commandGroupNames.map((groupName) => (
											<div key={groupName} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
												<p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1.5">{groupName}</p>
												<div className="space-y-1.5">
													{groupedCommandRows[groupName].map((entry, idx) => (
														<div key={`${groupName}-${entry.label}-${idx}`} className="rounded-md border border-white/10 bg-[#050505] px-2.5 py-1.5">
															<p className="text-[9px] uppercase tracking-wide text-muted-foreground/70">{entry.label}</p>
															<code className="block mt-0.5 text-[10px] font-mono text-white/90 break-all">{entry.command}</code>
														</div>
													))}
												</div>
											</div>
										))}
									</div>
								) : (
									<p className="text-[11px] text-white/50 italic">No commands were returned in this scan payload.</p>
								)}
							</div>
						)}
					</Card >
				</div >
			</div >

			{/* Footer Stats */}
			<div className="flex flex-col md:flex-row items-center justify-between mt-12 pt-8 border-t border-white/5 gap-6">
				<div className="flex flex-wrap items-center gap-8">
					<div className="flex items-center gap-3">
						<div className="size-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center">
							<TerminalSquare className="size-4 text-primary" />
						</div>
						<div>
							<p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Compute Usage</p>
							<div className="flex items-baseline gap-2">
								<p className="text-sm font-bold text-white">{results.token_usage?.total_tokens?.toLocaleString() || 0} <span className="text-[10px] font-medium text-muted-foreground/50 uppercase">Total</span></p>
								<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 font-medium">
									<span>{results.token_usage?.input_tokens?.toLocaleString() || 0} in</span>
									<span className="opacity-30">/</span>
									<span>{results.token_usage?.output_tokens?.toLocaleString() || 0} out</span>
								</div>
							</div>
						</div>
					</div>

					<div className="w-px h-6 bg-white/5 hidden md:block" />

					<div className="flex items-center gap-3">
						<div className="size-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center">
							<Clock className="size-4 text-primary" />
						</div>
						<div>
							<p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Scan Duration</p>
							<p className="text-sm font-bold text-white">{(scanTime ? (scanTime / 1000).toFixed(1) : "0.0")} <span className="text-[10px] font-medium text-muted-foreground/50">Seconds</span></p>
						</div>
					</div>
				</div>


				<div className="hidden md:flex items-center gap-2 text-muted-foreground/40 italic text-[10px]">
					<Lock className="size-3" />
					<span>Encrypted & Shared to {deployment.cloudProvider?.toUpperCase() || "Cloud"}</span>
				</div>
			</div>

			<div className="mt-6">
				<details className="rounded-xl border border-white/10 bg-white/[0.02]">
					<summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
						<span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">Full Payload</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-[10px] text-muted-foreground hover:text-white hover:bg-white/10"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								copyToClipboard(fullPayloadJson);
							}}
						>
							<Copy className="size-3 mr-1" />
							Copy JSON
						</Button>
					</summary>
					<div className="border-t border-white/10 p-4">
						<pre className="text-[11px] text-white/80 whitespace-pre-wrap break-words max-h-[28rem] overflow-auto stealth-scrollbar">
							{fullPayloadJson}
						</pre>
					</div>
				</details>
			</div>
		</div >
	);
}

// Simple syntax highlighter for the presentation
function highlightSyntax(code: string) {
	if (!code) return "";
	// Escape HTML tags in the source code first
	let escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");

	// 1. Strings (Do this first so we don't match keywords inside strings, 
	// and more importantly, so subsequent tag injection quotes aren't matched)
	escaped = escaped.replace(/"([^"]*)"/g, '<span class="text-emerald-400">"$1"</span>');
	escaped = escaped.replace(/'([^']*)'/g, '<span class="text-emerald-400">\'$1\'</span>');

	// 2. Keywords (Dockerfile)
	escaped = escaped.replace(/\b(FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS)\b/g, '<span class="text-primary font-bold">$1</span>');

	// 3. YAML Keys
	escaped = escaped.replace(/^(\s*)([a-zA-Z0-9_-]+):/gm, '$1<span class="text-white font-bold">$2</span>:');

	// 4. Comments (Only match if it's a real comment, not part of a string or tag)
	// We do this last to wrap any highlights that might be inside a comment line
	escaped = escaped.replace(/(^|\s)(#.*)/g, '$1<span class="text-neutral-600 font-italic">$2</span>');

	return escaped;
}

type CommandRow = {
	group: string;
	label: string;
	command: string;
};

function flattenCommandRows(value: unknown): CommandRow[] {
	const rows: CommandRow[] = [];

	const visit = (node: unknown, path: string[]) => {
		if (typeof node === "string") {
			const group = path.length > 1 ? path.slice(0, -1).join(" / ") : "general";
			const label = path.length > 0 ? path[path.length - 1] : "command";
			rows.push({ group, label, command: node });
			return;
		}

		if (Array.isArray(node)) {
			node.forEach((item, index) => visit(item, [...path, String(index)]));
			return;
		}

		if (node && typeof node === "object") {
			Object.entries(node as Record<string, unknown>).forEach(([key, inner]) => {
				visit(inner, [...path, key]);
			});
		}
	};

	visit(value, []);

	return rows.map((row) => ({
		...row,
		label: row.label === "0" ? "command" : row.label,
	}));
}

function formatJsonLimited(value: unknown, maxChars = 50000) {
	let serialized = "";
	try {
		serialized = JSON.stringify(value, null, 2);
	} catch {
		serialized = String(value);
	}
	if (serialized.length <= maxChars) return serialized;
	return `${serialized.slice(0, maxChars)}\n... [truncated ${serialized.length - maxChars} chars]`;
}


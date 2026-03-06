import * as React from "react";
import { useState } from "react";
import { SDArtifactsResponse, repoType } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, TerminalSquare, Copy, Settings, CheckCircle2, Server, Rocket, Clock, Database, Share2, Layers, Edit2, Save } from "lucide-react";
import { Separator } from "@/components/ui/separator";

type PostScanResultsProps = {
	results: SDArtifactsResponse;
	repo: repoType;
	scanTime?: number;
	onStartDeployment: () => void;
	onCancel: () => void;
	onUpdateResults?: (results: SDArtifactsResponse) => void;
};

export default function PostScanResults({ results, repo, scanTime, onStartDeployment, onCancel, onUpdateResults }: PostScanResultsProps) {
	const [activeTab, setActiveTab] = useState<string>("Dockerfile");
	const [isEditing, setIsEditing] = useState(false);
	const [editContent, setEditContent] = useState("");

	const dockerfileNames = results.dockerfiles ? Object.keys(results.dockerfiles) : [];
	const firstDockerfile = dockerfileNames.length > 0 ? dockerfileNames[0] : "Dockerfile";

	// Initialize to first dockerfile if "Dockerfile" isn't present but others are
	React.useEffect(() => {
		if (activeTab === "Dockerfile" && !dockerfileNames.includes("Dockerfile") && dockerfileNames.length > 0) {
			setActiveTab(dockerfileNames[0]);
		}
	}, [dockerfileNames, activeTab]);

	React.useEffect(() => {
		setIsEditing(false);
		setEditContent("");
	}, [activeTab]);

	const handleEdit = () => {
		let content = "";
		if (activeTab === "compose") content = results.docker_compose || "";
		else if (activeTab === "nginx") content = results.nginx_conf || "";
		else content = results.dockerfiles?.[activeTab] || "";

		setEditContent(content);
		setIsEditing(true);
	};

	const handleSave = () => {
		if (!onUpdateResults) return;

		const updatedResults = { ...results };
		if (activeTab === "compose") {
			updatedResults.docker_compose = editContent;
		} else if (activeTab === "nginx") {
			updatedResults.nginx_conf = editContent;
		} else {
			if (!updatedResults.dockerfiles) updatedResults.dockerfiles = {};
			updatedResults.dockerfiles[activeTab] = editContent;
		}

		onUpdateResults(updatedResults);
		setIsEditing(false);
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};

	const hasRisks = results.risks && results.risks.length > 0;
	// Calculate total hadolint warnings across services
	const hadolintCount = Object.values(results.hadolint_results || {}).reduce((acc, curr) => acc + (curr ? curr.split('\\n').length : 0), 0);

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] animate-in slide-in-from-bottom-4 duration-500">
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
				<div>
					<div className="flex items-center gap-3 mb-2">
						<Badge variant="outline" className="text-[10px] tracking-widest uppercase border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Analysis Complete</Badge>
						<span className="text-xs text-muted-foreground font-mono">ID: scan-{Math.random().toString(36).substring(7)}</span>
					</div>
					<h2 className="text-3xl font-bold tracking-tight text-foreground">Post-Scan Results</h2>
					<p className="text-muted-foreground mt-1 flex items-center gap-2">
						Repository: <span className="text-primary font-mono bg-primary/10 px-2 py-0.5 rounded">{repo.name}</span>
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Button variant="outline" className="border-border/50 text-foreground hover:bg-secondary/50">
						<Share2 className="size-4 mr-2" />
						Share Report
					</Button>
					<Button onClick={onStartDeployment} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(var(--primary),0.3)]">
						<Rocket className="size-4 mr-2" />
						Start Deployment
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
				<Card className="p-6 border-border/40 bg-card/60 relative overflow-hidden group">
					<div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
						<ShieldCheck className="size-24" />
					</div>
					<div className="flex justify-between items-start relative z-10">
						<span className="text-sm font-medium text-muted-foreground">Confidence Score</span>
						<CheckCircle2 className="size-5 text-emerald-400" />
					</div>
					<div className="mt-4 relative z-10">
						<div className="flex items-baseline gap-2">
							<span className="text-4xl font-bold">{Math.round((results.confidence || 0) * 100)}%</span>
							<span className="text-xs text-emerald-400 font-medium">High</span>
						</div>
						<div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden mt-4">
							<div className="h-full bg-primary" style={{ width: `${Math.round((results.confidence || 0) * 100)}%` }} />
						</div>
					</div>
				</Card>

				<Card className="p-6 border-border/40 bg-card/60 relative overflow-hidden group">
					<div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
						<CheckCircle2 className="size-24" />
					</div>
					<div className="flex justify-between items-start relative z-10">
						<span className="text-sm font-medium text-muted-foreground">Hadolint Results</span>
						{hadolintCount > 0 ? (
							<AlertTriangle className="size-5 text-amber-500" />
						) : (
							<CheckCircle2 className="size-5 text-emerald-400" />
						)}
					</div>
					<div className="mt-4 relative z-10">
						<span className="text-4xl font-bold">{hadolintCount > 0 ? `${hadolintCount} Warn` : 'Clean'}</span>
						<p className="text-xs text-muted-foreground mt-2">
							{hadolintCount > 0 ? "Non-critical Dockerfile lint warnings found." : "No critical Dockerfile lint errors found."}
						</p>
					</div>
				</Card>

				<Card className="p-6 border-border/40 bg-card/60 relative overflow-hidden group">
					<div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
						<AlertTriangle className="size-24" />
					</div>
					<div className="flex justify-between items-start relative z-10">
						<span className="text-sm font-medium text-muted-foreground">Risks Identified</span>
						{hasRisks ? (
							<AlertTriangle className="size-5 text-amber-500" />
						) : (
							<CheckCircle2 className="size-5 text-emerald-400" />
						)}
					</div>
					<div className="mt-4 relative z-10">
						<span className="text-4xl font-bold">{results.risks?.length || '00'}</span>
						<p className={`text-xs mt-2 font-medium ${hasRisks ? 'text-amber-500' : 'text-emerald-400'}`}>
							{hasRisks ? "Minor optimizations suggested" : "No obvious risks detected"}
						</p>
					</div>
				</Card>
			</div >

			<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
				<div className="col-span-1 lg:col-span-5 flex flex-col gap-8">
					<section>
						<h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
							<Layers className="size-5 text-primary" />
							Tech Stack Summary
						</h3>
						<div className="flex flex-wrap gap-2">
							{results.stack_summary.split(' ').filter(w => w.length > 2 && !['app', 'with', 'server', 'application'].includes(w.toLowerCase())).map((tech, i) => (
								<Badge key={i} variant="secondary" className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground border border-border/50 shadow-sm flex items-center gap-2">
									<TerminalSquare className="size-3.5 text-primary" />
									{tech}
								</Badge>
							))}
						</div>
					</section>

					<section>
						<h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
							<Server className="size-5 text-primary" />
							Detected Services
						</h3>
						<div className="flex flex-col gap-3">
							{results.services?.map((svc, i) => (
								<Card key={i} className="p-4 border-border/30 bg-background/40 hover:bg-secondary/20 transition-colors flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="p-2 bg-primary/10 rounded-lg">
											{svc.name.includes('web') ? <Settings className="size-4 text-primary" /> : <Database className="size-4 text-primary" />}
										</div>
										<div>
											<p className="font-semibold text-foreground text-sm">{svc.name}</p>
											<p className="text-xs text-muted-foreground">{svc.dockerfile_path}</p>
										</div>
									</div>
									<Badge variant="outline" className="font-mono text-[10px] tracking-wider border-border/50 bg-background text-muted-foreground">
										PORT {svc.port || 'N/A'}
									</Badge>
								</Card>
							))}
						</div>
					</section>

					<section>
						<h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
							<ShieldCheck className="size-5 text-primary" />
							Deployment Risks
						</h3>
						{hasRisks ? (
							<div className="flex flex-col gap-3">
								{results.risks.map((risk, i) => (
									<div key={i} className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 text-sm text-foreground flex gap-3 items-start shadow-sm">
										<AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
										<p className="leading-relaxed text-muted-foreground"><strong className="text-foreground">Notice:</strong> {risk}</p>
									</div>
								))}
							</div>
						) : (
							<div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-sm text-emerald-400 flex items-center gap-3">
								<CheckCircle2 className="size-4" />
								All checks passed cleanly.
							</div>
						)}
					</section>
				</div>

				<div className="col-span-1 lg:col-span-7 flex flex-col">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-semibold flex items-center gap-2">
							<TerminalSquare className="size-5 text-primary" />
							Infrastructure Files
						</h3>
						<div className="flex items-center gap-2">
							{isEditing ? (
								<Button variant="outline" size="sm" className="h-8 text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20" onClick={handleSave}>
									Save Changes
								</Button>
							) : (
								<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={handleEdit}>
									Edit File
								</Button>
							)}
							<Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={() => copyToClipboard(
								results.dockerfiles && results.dockerfiles[activeTab] ? results.dockerfiles[activeTab] :
									activeTab === "compose" ? results.docker_compose || "" :
										activeTab === "nginx" ? results.nginx_conf || "" : ""
							)}>
								<Copy className="size-3.5 mr-2" />
								Copy File
							</Button>
						</div>
					</div>

					<Card className="flex-1 flex flex-col bg-[#0d0d0d] border-[#1e1e1e] overflow-hidden min-h-[400px]">
						<div className="flex flex-wrap items-center gap-1 p-2 border-b border-[#1e1e1e]/50 bg-[#141414]">
							{dockerfileNames.map(name => {
								const displayName = name.toLowerCase() === 'dockerfile' ? 'Dockerfile' : name.toLowerCase().startsWith('dockerfile') ? name : `Dockerfile.${name}`;
								return (
									<button
										key={name}
										onClick={() => setActiveTab(name)}
										className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${activeTab === name ? 'bg-[#2a2a2a] text-white shadow-sm' : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'}`}
									>
										{displayName}
									</button>
								);
							})}
							{(!results.dockerfiles || dockerfileNames.length === 0) && (
								<button
									onClick={() => setActiveTab("Dockerfile")}
									className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${activeTab === 'Dockerfile' ? 'bg-[#2a2a2a] text-white shadow-sm' : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'}`}
								>
									Dockerfile
								</button>
							)}
							<button
								onClick={() => setActiveTab("compose")}
								className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${activeTab === 'compose' ? 'bg-[#2a2a2a] text-white shadow-sm' : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'}`}
							>
								docker-compose.yml
							</button>
							<button
								onClick={() => setActiveTab("nginx")}
								className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${activeTab === 'nginx' ? 'bg-[#2a2a2a] text-white shadow-sm' : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'}`}
							>
								nginx.conf
							</button>
						</div>
						{isEditing ? (
							<textarea
								value={editContent}
								onChange={(e) => setEditContent(e.target.value)}
								className="flex-1 w-full bg-transparent border-none outline-none p-4 font-mono text-xs md:text-sm text-gray-300 resize-none scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent leading-relaxed whitespace-pre"
								spellCheck="false"
							/>
						) : (
							<div className="flex-1 p-4 font-mono text-xs md:text-sm text-gray-300 overflow-y-auto whitespace-pre-wrap leading-relaxed scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
								{activeTab !== "compose" && activeTab !== "nginx" && (
									results.dockerfiles && results.dockerfiles[activeTab] ? (
										<div className="mb-6 last:mb-0">
											<div className="text-xs text-gray-500 mb-2 border-b border-gray-800 pb-1">
												# {activeTab.toLowerCase() === 'dockerfile' ? 'Dockerfile' : activeTab.toLowerCase().startsWith('dockerfile') ? activeTab : `Dockerfile.${activeTab}`}
											</div>
											<div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.dockerfiles[activeTab]) }} />
										</div>
									) : <span className="text-gray-500 italic">No {activeTab} generated.</span>
								)}
								{activeTab === "compose" && (
									results.docker_compose ? <div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.docker_compose) }} /> : <span className="text-gray-500 italic">No docker-compose.yml generated.</span>
								)}
								{activeTab === "nginx" && (
									results.nginx_conf ? <div dangerouslySetInnerHTML={{ __html: highlightSyntax(results.nginx_conf) }} /> : <span className="text-gray-500 italic">No nginx.conf generated.</span>
								)}
							</div>
						)}
					</Card >
				</div >
			</div >

			<div className="flex items-center justify-between mt-8 pt-6 border-t border-border/20 text-xs text-muted-foreground">
				<div className="flex items-center gap-6">
					<div className="flex items-center gap-2">
						<Layers className="size-3.5" />
						Token Usage: <span className="text-foreground font-semibold">{results.token_usage?.total_tokens?.toLocaleString() || 0}</span>
						<span className="text-muted-foreground/50">({results.token_usage?.input_tokens || 0} in / {results.token_usage?.output_tokens || 0} out)</span>
					</div>
					{scanTime && (
						<div className="flex items-center gap-2">
							<Clock className="size-3.5" />
							Scan Time: <span className="text-foreground font-semibold">{(scanTime / 1000).toFixed(1)}s</span>
						</div>
					)}
				</div>
				<div className="flex items-center gap-4">
					<button onClick={onCancel} className="hover:text-foreground transition-colors">Cancel</button>
					<button className="text-primary hover:text-primary/80 transition-colors">Download Report (PDF)</button>
				</div>
			</div>
		</div >
	);
}

// Simple syntax highlighter for the presentation
function highlightSyntax(code: string) {
	if (!code) return "";
	return code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

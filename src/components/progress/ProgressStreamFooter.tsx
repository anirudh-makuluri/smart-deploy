export function ProgressStreamFooter({ progress }: { progress: number }) {
	return (
		<div className="p-4 border-t border-[#1e1e1e]/50 bg-[#0a0a0a]">
			<div className="flex items-center justify-between mb-2">
				<span className="text-xs text-gray-400 font-medium">Total Progress</span>
				<span className="text-xs text-white font-mono">{progress}%</span>
			</div>
			<div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
				<div
					className="h-full bg-primary transition-[width] duration-500 ease-out"
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
}

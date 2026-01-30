import React from 'react'
import { ScrollArea } from './ui/scroll-area'
import { formatLogTimestamp } from '@/lib/utils'

export default function ServiceLogs({ logs }: { logs: {timestamp : string, message ?: string}[] }) {
	return (
		<ScrollArea className="h-[70vh] w-full rounded-md border border-[#1e3a5f]/60 bg-[#0c1929]/40 p-4">
			<div className="space-y-2 font-mono text-sm text-[#94a3b8]">
				{logs.length == 0 ? (
					<p className="text-center text-4xl mt-10 text-[#64748b]">😴 No logs yet</p>
				) : (
					logs.map((log, i) => (
						<div key={i} className="break-words whitespace-pre-wrap w-full">
							<span className="text-[#14b8a6]">{formatLogTimestamp(log.timestamp)}</span>
							{" - "}
							<span className="break-words whitespace-pre-wrap text-[#e2e8f0]">{typeof log.message === "string" ? log.message : JSON.stringify(log.message)}</span>
						</div>
					))
				)}
			</div>
		</ScrollArea>
	);
}

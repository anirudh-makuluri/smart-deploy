import React from 'react'
import { ScrollArea } from './ui/scroll-area'
import { formatLogTimestamp } from '@/lib/utils'

export default function ServiceLogs({ logs }: { logs: {timestamp : string, message ?: string}[] }) {
	return (
		<ScrollArea className="h-[70vh] w-full rounded-md border p-4">
			<div className="space-y-2 font-mono text-sm text-muted-foreground">
				{logs.length == 0 ? (
					<p className="text-center text-4xl mt-10">😴 No logs yet</p>
				) : (
					logs.map((log, i) => (
						<div key={i} className="break-words whitespace-pre-wrap w-full">
							<span className="text-blue-500">{formatLogTimestamp(log.timestamp)}</span>
							{" - "}
							<span className='break-words whitespace-pre-wrap'>{typeof log.message === "string" ? log.message : JSON.stringify(log.message)}</span>
						</div>
					))
				)}
			</div>
		</ScrollArea>
	)
}

import React from 'react'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { signOut } from 'next-auth/react'

export default function Header() {
	return (
		<div className="w-full">
			<div className="px-4 py-3 flex flex-row justify-between items-center">
				<p className="font-bold">Smart Deploy</p>
				<Button onClick={() => { signOut() }} className="bg-destructive">Sign Out</Button>
			</div>
			<Separator />
		</div>
	)
}

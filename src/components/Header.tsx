import React from 'react'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { signOut } from 'next-auth/react'
import Link from 'next/link'

export default function Header() {
	return (
		<div className="w-full">
			<div className="px-4 py-3 flex flex-row justify-between items-center">
				<p className="font-bold">Smart Deploy</p>
				<div className='flex flex-row space-x-3.5 items-center'>
					<Button variant={'outline'} asChild><Link href={'/'}>Dashboard</Link></Button>
					<Button onClick={() => { signOut() }} className="bg-destructive">Sign Out</Button>
				</div>
			</div>
			<Separator />
		</div>
	)
}

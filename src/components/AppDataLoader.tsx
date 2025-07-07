"use client"
import { useAppData } from "@/store/useAppData";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

export function AppDataLoader({ children }: React.PropsWithChildren) {
	const [progress, setProgress] = useState(0);
	const { status } = useSession(); // 'loading' | 'authenticated' | 'unauthenticated'
	const { isLoading, fetchAll, unAuthenticated } = useAppData();

	useEffect(() => {
		console.log(status)
		if (status === 'authenticated') fetchAll();
		if(status === 'unauthenticated') unAuthenticated();

		const interval = setInterval(() => {
			setProgress(prev => {
				if (prev >= 90) return prev; // cap at 90%
				return prev + 5;
			});
		}, 200);

		return () => clearInterval(interval);
	}, [status]);

	useEffect(() => {
		if (!isLoading) setProgress(100)
	}, [isLoading]);

	if (isLoading || progress < 100) {
		return (
			<div className="p-4 bg-card h-[100vh] flex flex-col justify-center items-center">
				<div className="mb-4 text-center text-4xl font-bold">Loading your data...</div>
				<div className="w-[80%] h-2 bg-gray-200 rounded-2xl overflow-hidden">
					<div
						className="h-full bg-blue-500 transition-all duration-300"
						style={{ width: `${progress}%` }}
					/>
				</div>
			</div>
		);
	}


	return children;
}

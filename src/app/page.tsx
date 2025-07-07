"use client"
import DashboardMain from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import Header from "@/components/Header";
import { Separator } from "@/components/ui/separator";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { AppDataLoader } from '@/components/AppDataLoader';
import { useAppData } from '@/store/useAppData';


export default function Home() {
	return (
		<div className="bg-muted flex min-h-svh flex-col">
			<Header />
			<div className="flex flex-row w-full">
				<DashboardSideBar />
				<Separator orientation="vertical" />
				<DashboardMain />
			</div>
		</div>
	)
}

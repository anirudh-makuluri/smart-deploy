"use client";

import * as React from "react";
import { use } from "react";
import DeployWorkspace from "@/components/DeployWorkspace";

export default function Page({ params }: { params: Promise<{ id: string; username: string; reponame: string }> }) {
	const { id, username, reponame } = use(params);
	return <DeployWorkspace repoParams={{ id, username, reponame }} />;
}

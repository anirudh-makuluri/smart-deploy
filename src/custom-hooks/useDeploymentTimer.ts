/**
 * useDeploymentTimer
 * Tracks elapsed time during deployment
 */

import { useState, useEffect } from "react";

interface UseDeploymentTimerProps {
	isActive: boolean;
	deployStatus: "not-started" | "running" | "success" | "error";
}

export function useDeploymentTimer({ isActive, deployStatus }: UseDeploymentTimerProps) {
	const [elapsedSeconds, setElapsedSeconds] = useState(0);

	useEffect(() => {
		if (!isActive || deployStatus === "not-started") {
			setElapsedSeconds(0);
			return;
		}

		const interval = setInterval(() => {
			setElapsedSeconds((prev) => prev + 1);
		}, 1000);

		// Stop timer when deployment completes
		if (deployStatus === "success" || deployStatus === "error") {
			clearInterval(interval);
		}

		return () => clearInterval(interval);
	}, [isActive, deployStatus]);

	const formatTime = (seconds: number) => {
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hrs > 0) {
			return `${hrs}h ${mins}m ${secs}s`;
		} else if (mins > 0) {
			return `${mins}m ${secs}s`;
		} else {
			return `${secs}s`;
		}
	};

	return {
		elapsedSeconds,
		formattedTime: formatTime(elapsedSeconds),
	};
}

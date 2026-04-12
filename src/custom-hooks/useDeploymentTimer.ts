/**
 * useDeploymentTimer
 * Tracks elapsed time during deployment
 */

import { useEffect, useState } from "react";

interface UseDeploymentTimerProps {
	isActive: boolean;
	deployStatus: "not-started" | "running" | "success" | "error";
}

export function useDeploymentTimer({ isActive, deployStatus }: UseDeploymentTimerProps) {
	const [elapsedSeconds, setElapsedSeconds] = useState(0);

	useEffect(() => {
		let resetTimeout: ReturnType<typeof setTimeout> | null = null;
		let interval: ReturnType<typeof setInterval> | null = null;

		if (!isActive || deployStatus === "not-started") {
			resetTimeout = setTimeout(() => {
				setElapsedSeconds(0);
			}, 0);
		} else if (deployStatus === "running") {
			resetTimeout = setTimeout(() => {
				setElapsedSeconds(0);
			}, 0);
			interval = setInterval(() => {
				setElapsedSeconds((prev) => prev + 1);
			}, 1000);
		}

		return () => {
			if (resetTimeout) {
				clearTimeout(resetTimeout);
			}
			if (interval) {
				clearInterval(interval);
			}
		};
	}, [isActive, deployStatus]);

	const formatTime = (seconds: number) => {
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hrs > 0) {
			return `${hrs}h ${mins}m ${secs}s`;
		} else if (mins > 0) {
			return `${mins}m ${secs}s`;
		}

		return `${secs}s`;
	};

	return {
		elapsedSeconds,
		formattedTime: formatTime(elapsedSeconds),
	};
}

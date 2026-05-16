import { useState, useEffect } from 'react';

export const FREE_DAILY_LIMIT = 30;
export const WARNING_THRESHOLD = 25;

export function useClarificationUsage() {
  const [usedMinutes, setUsedMinutes] = useState(0);
  
  return {
    usedMinutes: 0,
    remainingMinutes: 30,
    hasReachedLimit: false,
    shouldShowWarning: false,
    addUsedMinutes: (minutes: number) => {}
  };
}
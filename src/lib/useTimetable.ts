import { useEffect, useSyncExternalStore } from 'react';
import { loadRuntimeTimetable, subscribeTimetable, timetableVersion } from './officialTimetable';

/**
 * Fetches the server's fresher timetable once on mount and returns a number that
 * changes whenever a new table arrives, so anything memoised on prayer times can
 * list it as a dependency and recompute.
 */
export function useTimetableVersion(): number {
  useEffect(() => {
    void loadRuntimeTimetable();
  }, []);
  return useSyncExternalStore(subscribeTimetable, timetableVersion, timetableVersion);
}

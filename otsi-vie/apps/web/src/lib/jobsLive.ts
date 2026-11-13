/** The job list the Jobs Center reads (GET /v1/jobs: every 3 s while something runs), shared with the live activity line. */
import type { JobList } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";

const EVENT = "otsi-jobs";
let last: JobList | null = null;

export function publishJobs(list: JobList) { last = list; window.dispatchEvent(new Event(EVENT)); }

export function useJobs(): JobList | null {
  const [v, setV] = useState<JobList | null>(last);
  useEffect(() => {
    const on = () => setV(last);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
}

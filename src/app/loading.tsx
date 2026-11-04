import { RunnerLoader } from "@/components/layout/runner-loader";

/** First load of any page that has no loading screen of its own. */
export default function Loading() {
  return <RunnerLoader />;
}

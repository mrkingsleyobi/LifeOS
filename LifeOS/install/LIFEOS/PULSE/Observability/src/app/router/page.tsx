"use client";

// Router — data: GET /api/router (modules/lifeos-ledgers.ts).
import { GitFork } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function RouterPage() {
  return <SubsystemView endpoint="/api/router" title="Router" icon={GitFork} />;
}

"use client";

// Achilles — data: GET /api/achilles (modules/lifeos-ledgers.ts).
import { ShieldAlert } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function AchillesPage() {
  return <SubsystemView endpoint="/api/achilles" title="Achilles" icon={ShieldAlert} />;
}

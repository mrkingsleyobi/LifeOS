"use client";

// Errata — data: GET /api/errata (modules/lifeos-ledgers.ts).
import { MessageSquareWarning } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function ErrataPage() {
  return <SubsystemView endpoint="/api/errata" title="Errata" icon={MessageSquareWarning} />;
}

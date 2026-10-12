"use client";

// Socrates — data: GET /api/socrates (modules/lifeos-ledgers.ts).
import { HelpCircle } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function SocratesPage() {
  return <SubsystemView endpoint="/api/socrates" title="Socrates" icon={HelpCircle} />;
}

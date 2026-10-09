"use client";

// Vera — data: GET /api/vera (modules/lifeos-ledgers.ts).
import { UserRoundSearch } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function VeraPage() {
  return <SubsystemView endpoint="/api/vera" title="Vera" icon={UserRoundSearch} />;
}

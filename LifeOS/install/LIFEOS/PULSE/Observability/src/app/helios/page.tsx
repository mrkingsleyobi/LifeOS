"use client";

// Helios — data: GET /api/helios (modules/lifeos-ledgers.ts).
import { Swords } from "lucide-react";
import SubsystemView from "@/components/SubsystemView";

export default function HeliosPage() {
  return <SubsystemView endpoint="/api/helios" title="Helios" icon={Swords} />;
}

import { ScanCard } from "@/components/scan-card";
import { Wall } from "@/components/wall";
export default function WallPage() { return <Wall scan={<ScanCard size={168} label="SCAN TO PLAY" note="Open the game on your phone and find a match." />} />; }

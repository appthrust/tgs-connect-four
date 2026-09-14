import { Play } from "@/components/play";
export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Play matchId={id} />;
}

import { wall } from "@/lib/matches";
import { failure, json } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try { return json(wall()); } catch (error) { return failure(error); }
}

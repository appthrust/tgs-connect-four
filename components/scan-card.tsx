import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

/** Public origin of this request, honouring the trusted ingress's forwarded headers. */
async function publicOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Server-rendered QR code for this site's public URL: inline SVG, no client JavaScript. */
export async function ScanCard({ size, label = "SCAN TO PLAY", note }: { size: number; label?: string; note?: string }) {
  const origin = await publicOrigin();
  const url = `${origin}/`;
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const quiet = 2;
  const span = modules.size + quiet * 2;
  let path = "";
  for (let row = 0; row < modules.size; row++) {
    for (let column = 0; column < modules.size; column++) {
      if (modules.get(row, column)) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return <div className="scan-card">
    <svg className="scan-code" width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${url}`}>
      <rect width={span} height={span} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
    <div className="scan-text"><strong>{label}</strong>{note && <p>{note}</p>}<code>{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</code></div>
  </div>;
}

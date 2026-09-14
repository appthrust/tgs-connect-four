import Link from "next/link";
export function Header() {
  return <header className="site-header"><Link href="/" className="brand" aria-label="AppThrust Connect Four home"><span className="four-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>appthrust<span className="brand-divider">/</span><strong>PLAY LAB</strong></span></Link><Link href="/wall" className="wall-link"><span className="status-dot" />Match wall <span aria-hidden="true">↗</span></Link></header>;
}

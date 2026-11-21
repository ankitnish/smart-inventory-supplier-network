import Link from "next/link";
import { ArrowRight, BarChart3, Bell, Boxes, ClipboardCheck, LineChart, Lock, PackageSearch, ShoppingCart, Sparkles, Truck, Users } from "lucide-react";
import { Hero3D } from "@/components/landing/Hero3D";
import { Reveal } from "@/components/landing/Reveal";

const features = [
  { i: Boxes, t: "Real-time inventory tracking", d: "Every sale, adjustment and delivery updates stock, with a full audit trail of who changed what and why." },
  { i: ShoppingCart, t: "Sales and stock movements", d: "Record multi-item sales. Stock is checked and reduced in one step, and a retried request never counts twice." },
  { i: LineChart, t: "Demand forecasting", d: "Statistical baselines (moving averages and day-of-week patterns) scored against your own sales history." },
  { i: Bell, t: "Stockout-risk detection", d: "See how many days of stock remain against supplier lead time, with low-stock alerts." },
  { i: Sparkles, t: "Reorder recommendations", d: "Quantities that account for incoming orders, safety stock, lead time and expiring goods, with the working shown." },
  { i: PackageSearch, t: "Supplier discovery and comparison", d: "Compare real supplier offers on price, availability, delivery time and reliability, with weights you control." },
  { i: Truck, t: "Purchase-order tracking", d: "Follow each order from draft to delivery. Stock is added once, only when you confirm receipt." },
  { i: BarChart3, t: "Alerts and analytics", d: "A live dashboard of sales, stock value, top sellers and slow movers." },
];
const flow = ["Sale recorded", "Inventory updated", "Demand forecast", "Stockout risk calculated", "Reorder recommendation", "Supplier comparison", "Purchase order", "Delivery", "Inventory replenished"];
const faq = [
  ["Does the platform order stock automatically?", "No. Recommendations are advisory. You review, adjust and confirm them, and a confirmed recommendation only creates a draft order that you still submit."],
  ["How accurate are the forecasts?", "They are statistical baselines, not guarantees. Each recommendation shows the method used and its back-test error on your own history, and says so when there is too little data."],
  ["Can I track products that expire?", "Yes. Perishable products are tracked by batch with expiry dates. The oldest stock sells first, expired stock is blocked from sale, and stock that will expire unsold is not counted as available."],
  ["Who can see my data?", "Shops see only their own records and suppliers see only their own listings and orders. Permissions are enforced on the server, never just in the browser."],
  ["Is there a demo?", "Local development includes clearly labelled fictional demo data. Log in with a demo account to explore."],
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-lime text-bg"><Boxes className="h-5 w-5" /></span>Smart Inventory</Link>
          <nav aria-label="Sections" className="ml-6 hidden gap-5 text-sm text-muted md:flex">{[["Features", "#features"], ["How It Works", "#how"], ["AI Insights", "#ai"], ["Supplier Network", "#network"], ["About", "#about"]].map(([l, h]) => <a key={h} href={h} className="hover:text-ink">{l}</a>)}</nav>
          <div className="ml-auto flex items-center gap-2"><Link href="/login" className="rounded-lg px-3 py-2 text-sm hover:bg-white/5">Login</Link><Link href="/register" className="rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-bg hover:bg-lime-dim">Get Started</Link></div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 lg:grid-cols-2 lg:py-20">
        <div>
          <p className="mb-4 inline-block rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs text-lime">Track → Predict → Recommend → Order</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your Inventory. Smarter. <span className="text-lime">Your Supply Chain. Connected.</span></h1>
          <p className="mt-5 max-w-lg text-lg text-muted">Manage stock, predict demand, discover reliable suppliers, and make smarter purchasing decisions from one intelligent platform.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-lime px-5 py-3 font-semibold text-bg hover:bg-lime-dim">Get Started<ArrowRight className="h-4 w-4" /></Link>
            <Link href="/login" className="rounded-lg border border-line px-5 py-3 font-medium hover:border-lime/60">Explore Dashboard</Link></div>
        </div>
        <Hero3D />
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <Reveal><h2 className="text-3xl font-semibold tracking-tight">Everything from shelf to supplier</h2><p className="mt-2 max-w-2xl text-muted">One system for the whole loop, built so the numbers can be checked, not just trusted.</p></Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{features.map((f, n) => <Reveal key={f.t} delay={n * 0.04}><div className="h-full rounded-xl border border-line bg-card p-5 transition hover:-translate-y-1 hover:border-lime/40 hover:shadow-glow"><f.i className="mb-3 h-6 w-6 text-lime" aria-hidden /><h3 className="font-medium">{f.t}</h3><p className="mt-1 text-sm text-muted">{f.d}</p></div></Reveal>)}</div>
      </section>

      <section id="how" className="scroll-mt-20 border-y border-line bg-bg2 py-16"><div className="mx-auto max-w-6xl px-4">
        <Reveal><h2 className="text-3xl font-semibold tracking-tight">How it works</h2><p className="mt-2 text-muted">A closed loop: every delivery feeds the next forecast.</p></Reveal>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{flow.map((s, i) => <li key={s} className="relative rounded-xl border border-line bg-card p-4"><span className="mb-2 grid h-6 w-6 place-items-center rounded-full bg-lime/15 text-xs font-semibold text-lime">{i + 1}</span><p className="text-sm font-medium">{s}</p></li>)}</ol>
      </div></section>

      <section id="ai" className="mx-auto grid max-w-6xl scroll-mt-20 gap-8 px-4 py-16 lg:grid-cols-2">
        <Reveal><h2 className="text-3xl font-semibold tracking-tight">AI insights you can inspect</h2>
          <p className="mt-3 text-muted">Each recommendation lists its inputs: stock, sales history, lead time, incoming orders and safety stock. You can see why a number was suggested and adjust it before anything happens.</p>
          <ul className="mt-5 space-y-2 text-sm text-muted">{["Forecasts are baselines, tested against your own history (MAE and RMSE).", "Too little data? The system says so instead of guessing.", "Perishable stock that will expire unsold is excluded from available stock.", "Nothing is ordered without your confirmation."].map((t) => <li key={t} className="flex gap-2"><ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />{t}</li>)}</ul></Reveal>
        <Reveal delay={0.1}><div className="rounded-xl border border-line bg-card p-5 text-sm"><p className="mb-3 text-xs uppercase tracking-wide text-muted">Example (illustrative numbers)</p>
          <dl className="space-y-2">{[["Current stock", "20 units"], ["Expected demand, 9 days", "45 units"], ["Supplier lead time", "2 days"], ["Recommended order", "25 units"]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-line/60 pb-2 last:border-0"><dt className="text-muted">{k}</dt><dd className="font-medium text-lime">{v}</dd></div>)}</dl>
          <p className="mt-3 text-xs text-muted">Real recommendations are calculated from your own data.</p></div></Reveal>
      </section>

      <section id="network" className="border-y border-line bg-bg2 py-16"><div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-2">
        {[{ i: Users, t: "For shop owners", d: ["Compare real offers side by side", "Order only what you confirmed", "Track every delivery to your shelf"] }, { i: Truck, t: "For suppliers", d: ["List products, prices and lead times", "Accept orders with stock reserved for them", "Show verified, trackable fulfilment"] }].map((b) => (
          <Reveal key={b.t}><div className="h-full rounded-xl border border-line bg-card p-6"><b.i className="mb-3 h-6 w-6 text-lime" aria-hidden /><h3 className="text-xl font-medium">{b.t}</h3><ul className="mt-3 space-y-1.5 text-sm text-muted">{b.d.map((x) => <li key={x}>• {x}</li>)}</ul></div></Reveal>))}</div></section>

      <section id="about" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <Reveal><div className="flex items-start gap-3"><Lock className="mt-1 h-6 w-6 text-lime" aria-hidden /><div><h2 className="text-3xl font-semibold tracking-tight">Security and reliability</h2>
          <p className="mt-2 max-w-3xl text-muted">Passwords are hashed, sessions use httpOnly cookies, and every permission is checked on the server. Stock changes happen inside database transactions, so simultaneous sales cannot oversell and a delivery cannot add stock twice. Administrative actions are audit-logged.</p></div></div></Reveal>
        <h2 className="mt-14 text-3xl font-semibold tracking-tight">FAQ</h2>
        <div className="mt-5 divide-y divide-line rounded-xl border border-line bg-card">{faq.map(([q, a]) => <details key={q} className="group p-5"><summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary><p className="mt-2 text-sm text-muted">{a}</p></details>)}</div>
      </section>

      <footer className="border-t border-line py-10"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-muted">
        <p>© Smart Inventory + Supplier Network</p><nav aria-label="Footer" className="flex gap-5"><a href="#features" className="hover:text-ink">Features</a><a href="#how" className="hover:text-ink">How it works</a><Link href="/login" className="hover:text-ink">Login</Link><Link href="/register" className="hover:text-ink">Register</Link></nav><p>Contact: your-email@example.com (placeholder)</p></div></footer>
    </div>
  );
}

import { ProtocolPulseCard } from "@/components/dashboard/ProtocolPulseCard";

export default function StatisticsPage() {
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <p className="font-body text-xs tracking-[0.12em] text-white/60 uppercase">
          Analytics
        </p>
        <h1 className="font-heading mt-2 text-3xl md:text-5xl">
          Protocol Statistics
        </h1>
        <p className="font-body mt-4 text-white/72">
          Live TVL, active streams, and settlement volume across the StellarStream protocol.
        </p>
      </section>

      <ProtocolPulseCard />
    </div>
  );
}
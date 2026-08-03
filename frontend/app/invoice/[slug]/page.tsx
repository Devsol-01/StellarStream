"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Clock, Copy, Check, Loader2, WalletMinimal, ArrowRight } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { QRStudio } from "@/components/qr-studio";

type InvoiceStatus = "DRAFT" | "SIGNED" | "COMPLETED" | "EXPIRED";

interface InvoiceLinkInfo {
  id: string;
  slug: string;
  sender: string;
  receiver: string;
  amount: string;
  tokenAddress: string;
  duration: number;
  description?: string;
  customMessage?: string;
  status: InvoiceStatus;
  expiresAt?: string;
  createdAt: string;
  shareUrl: string;
  viewCount: number;
}

const statusStyles: Record<InvoiceStatus, string> = {
  DRAFT: "bg-amber-500/10 text-amber-300 border border-amber-400/20",
  SIGNED: "bg-sky-500/10 text-sky-300 border border-sky-400/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20",
  EXPIRED: "bg-red-500/10 text-red-300 border border-red-400/20",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export default function InvoiceLinkLandingPage() {
  const params = useParams();
  const { slug } = params as { slug?: string };
  const { openModal } = useWallet();

  const [invoice, setInvoice] = useState<InvoiceLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;

    setLoading(true);
    setError(null);
    fetch(`/api/v1/invoice-links/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || `Failed to load payment request (${res.status})`);
        }
        return res.json() as Promise<InvoiceLinkInfo>;
      })
      .then((data) => setInvoice(data))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to fetch payment request.");
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const handleCopyLink = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const qrUrl =
    invoice?.shareUrl ??
    (slug ? `${typeof window !== "undefined" ? window.location.origin : "https://stellarstream.app"}/invoice/${slug}` : "");

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#030305] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.16),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(138,0,255,0.18),transparent_22%)]" />
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.06),transparent_18%)]" />
      <div className="relative z-10 max-w-6xl mx-auto px-4 py-20">
        <div className="glass-card border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.3)] mx-auto max-w-3xl p-8 md:p-12 space-y-6">
          <div>
            <p className="text-sm uppercase tracking-[0.32em] text-white/50">Payment Request</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {invoice ? `${invoice.amount} ${invoice.tokenAddress || "Asset"}` : loading ? "Loading…" : "Payment request"}
            </h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-sm text-white/70">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading payment request…
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-6 text-sm text-red-200">
              {error || "This payment request could not be found or has expired."}
            </div>
          ) : invoice ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Status</p>
                  <div
                    className={`mt-4 inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${statusStyles[invoice.status]}`}
                  >
                    {invoice.status}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Stream Duration</p>
                  <p className="mt-4 text-lg font-semibold text-white/90">{formatDuration(invoice.duration)}</p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Expires
                  </p>
                  <p className="mt-4 text-sm font-semibold text-white/90">
                    {invoice.expiresAt
                      ? new Date(invoice.expiresAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "No expiry"}
                  </p>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">From</p>
                    <p className="mt-3 break-all font-mono text-sm text-white/90">{truncateAddress(invoice.sender)}</p>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">To</p>
                    <p className="mt-3 break-all font-mono text-sm text-white/90">{truncateAddress(invoice.receiver)}</p>
                  </div>
                </div>

                {invoice.customMessage && (
                  <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-400/60">Message from Sender</p>
                    <p className="mt-2 text-sm text-white/90 font-medium">{invoice.customMessage}</p>
                  </div>
                )}

                {invoice.description && (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Note</p>
                    <p className="mt-2 text-sm text-white/80">{invoice.description}</p>
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={openModal}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    <WalletMinimal className="h-4 w-4" />
                    Connect Wallet to Pay
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/[0.08]"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!loading && !error && qrUrl && <QRStudio url={qrUrl} />}
        </div>
      </div>
    </div>
  );
}

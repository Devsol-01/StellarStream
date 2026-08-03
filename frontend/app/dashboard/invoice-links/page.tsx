"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { QrCode, Plus, X, Link2, Clock, Eye, BarChart3, Copy, Check, Loader2 } from "lucide-react";
import { QRStudio } from "@/components/qr-studio";

type InvoiceStatus = "DRAFT" | "SIGNED" | "COMPLETED" | "EXPIRED";

interface InvoiceLink {
  id: string;
  slug: string;
  sender: string;
  receiver: string;
  amount: string;
  tokenAddress: string;
  duration: number;
  description?: string;
  customMessage?: string;
  pdfUrl?: string;
  xdrParams: string;
  status: InvoiceStatus;
  expiresAt?: string;
  createdAt: string;
  shareUrl?: string;
  updatedAt: string;
  viewCount: number;
  lastViewedAt?: string;
}

interface ProcessDisbursementResponse {
  success: boolean;
  data: {
    valid: { address: string; amountStroops: string }[];
    errors: { row: number; address: string; reason: string }[];
    totalRows: number;
  };
}

interface CreateFormData {
  receiver: string;
  amount: string;
  tokenAddress: string;
  duration: string;
  description: string;
  customMessage: string;
  expiresInDays: string;
}

const UNPAID_STATUSES: InvoiceStatus[] = ["DRAFT", "SIGNED"];

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  DRAFT: "bg-amber-500/10 text-amber-300 border border-amber-400/20",
  SIGNED: "bg-sky-500/10 text-sky-300 border border-sky-400/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20",
  EXPIRED: "bg-red-500/10 text-red-300 border border-red-400/20",
};

const TOKENS = ["USDC", "XLM", "USDT", "DAI"];
const DURATION_PRESETS = [
  { label: "1 Hour", seconds: "3600" },
  { label: "1 Day", seconds: "86400" },
  { label: "1 Week", seconds: "604800" },
  { label: "1 Month", seconds: "2592000" },
];

const EMPTY_FORM: CreateFormData = {
  receiver: "",
  amount: "",
  tokenAddress: "USDC",
  duration: "3600",
  description: "",
  customMessage: "",
  expiresInDays: "30",
};

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 2592000) return `${Math.round(seconds / 86400)}d`;
  return `${Math.round(seconds / 2592000)}mo`;
}

export default function InvoiceLinksPage() {
  const [invoices, setInvoices] = useState<InvoiceLink[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrOpenId, setQrOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bundleStatus, setBundleStatus] = useState<"idle" | "pending" | "complete" | "error">("idle");
  const [bundleMessage, setBundleMessage] = useState<string>("");
  const [bundleResult, setBundleResult] = useState<ProcessDisbursementResponse["data"] | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormData>(EMPTY_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<InvoiceLink | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    async function loadInvoices() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/v1/invoice-links");
        if (!resp.ok) {
          throw new Error(`Failed to load invoices: ${resp.status}`);
        }
        const data = (await resp.json()) as InvoiceLink[];
        setInvoices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadInvoices();
  }, []);

  const unpaidInvoices = useMemo(
    () => invoices.filter((invoice) => UNPAID_STATUSES.includes(invoice.status)),
    [invoices],
  );

  const selectedInvoices = useMemo(
    () => unpaidInvoices.filter((invoice) => selectedIds.has(invoice.id)),
    [unpaidInvoices, selectedIds],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const addToSplitter = (invoice: InvoiceLink) => {
    toggleSelect(invoice.id);
  };

  const toggleQr = (id: string) => {
    setQrOpenId((prev) => (prev === id ? null : id));
  };

  const shareUrlFor = (invoice: InvoiceLink) =>
    invoice.shareUrl ??
    `${typeof window !== "undefined" ? window.location.origin : ""}/invoice/${invoice.slug}`;

  const handleCopyLink = async (invoice: InvoiceLink) => {
    const url = shareUrlFor(invoice);
    await navigator.clipboard.writeText(url);
    setCopiedSlug(invoice.slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const bundleToSplitter = async () => {
    if (selectedInvoices.length === 0) {
      setBundleMessage("Select at least one invoice to bundle into a splitter disbursement.");
      return;
    }

    setBundleStatus("pending");
    setBundleMessage("Processing bundle to splitter...");
    setBundleResult(null);

    try {
      const payload = selectedInvoices.map((invoice) => ({
        address: invoice.receiver,
        amount: invoice.amount,
      }));

      const resp = await fetch("/api/v3/process-disbursement-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Disbursement preprocessing failed: ${resp.status}`);
      }

      const body = (await resp.json()) as ProcessDisbursementResponse;
      if (!body.success) {
        throw new Error("Disbursement preprocessing returned success=false");
      }

      setBundleResult(body.data);
      setBundleStatus("complete");
      setBundleMessage("Splitter bundle prepared successfully.");
    } catch (err) {
      setBundleStatus("error");
      setBundleMessage(err instanceof Error ? err.message : "Unknown error during bundling.");
    }
  };

  // Create Payment Link handler
  const handleCreateLink = useCallback(async () => {
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const duration = parseInt(createForm.duration, 10);
      if (!createForm.receiver || !createForm.amount || !createForm.tokenAddress || isNaN(duration)) {
        throw new Error("Please fill in all required fields");
      }

      if (parseFloat(createForm.amount) <= 0) {
        throw new Error("Amount must be greater than 0");
      }

      const expiresAt = createForm.expiresInDays
        ? new Date(Date.now() + parseInt(createForm.expiresInDays, 10) * 86400000).toISOString()
        : undefined;

      const resp = await fetch("/api/v1/invoice-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: createForm.receiver,
          amount: createForm.amount,
          tokenAddress: createForm.tokenAddress,
          duration,
          description: createForm.description || undefined,
          customMessage: createForm.customMessage || undefined,
          expiresAt,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to create link (${resp.status})`);
      }

      const newLink = (await resp.json()) as InvoiceLink;
      setCreateSuccess(newLink);
      setInvoices((prev) => [newLink, ...prev]);
      setCreateForm(EMPTY_FORM);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreateLoading(false);
    }
  }, [createForm]);

  const updateForm = (field: keyof CreateFormData, value: string) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
    setCreateError(null);
  };

  const totalViews = useMemo(
    () => invoices.reduce((sum, inv) => sum + (inv.viewCount ?? 0), 0),
    [invoices],
  );

  return (
    <main className="space-y-6 p-6 text-white">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-heading">Nebula-Pay Invoice Dashboard</h1>
          <p className="text-sm text-slate-300">
            Create shareable payment links, track views, and bundle invoices into splitter disbursements.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              showAnalytics
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-400"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </button>

          <button
            onClick={bundleToSplitter}
            disabled={bundleStatus === "pending" || selectedInvoices.length === 0}
            className="rounded-xl bg-cyan-400 px-4 py-2 font-bold text-black transition hover:bg-cyan-300 disabled:opacity-50"
            data-testid="bundle-button"
          >
            Bundle Selected ({selectedInvoices.length}) to Splitter
          </button>

          <button
            onClick={() => {
              setCreateSuccess(null);
              setCreateError(null);
              setCreateForm(EMPTY_FORM);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 font-bold text-black transition hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Create Payment Link
          </button>
        </div>
      </header>

      {/* Analytics Summary */}
      {showAnalytics && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-fade-in-down">
          {[
            { label: "Total Links", value: invoices.length, icon: Link2 },
            { label: "Total Views", value: totalViews, icon: Eye },
            { label: "Active Links", value: unpaidInvoices.length, icon: Clock },
            { label: "Avg Views", value: invoices.length ? Math.round(totalViews / invoices.length) : 0, icon: BarChart3 },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-xs text-white/40 mb-1">
                  <Icon className="h-3 w-3" />
                  {stat.label}
                </div>
                <p className="text-2xl font-bold text-white/90">{stat.value}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div
            className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#1a1f27] p-6 md:p-8 animate-scale-in"
            style={{ boxShadow: "0 0 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" }}
          >
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/40 hover:bg-white/[0.08] hover:text-white/70 transition"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="text-xl font-heading font-bold mb-1">Create Payment Link</h2>
            <p className="text-sm text-white/40 mb-6">Generate a shareable payment link with amount lock and expiry.</p>

            {createSuccess ? (
              <div className="space-y-4 animate-fade-in-up">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5 text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 border border-emerald-400/20">
                    <Check className="h-6 w-6 text-emerald-400" />
                  </div>
                  <p className="font-bold text-emerald-300">Payment Link Created!</p>
                  <p className="text-sm text-white/60">{createSuccess.amount} {createSuccess.tokenAddress} → {truncateAddress(createSuccess.receiver)}</p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-mono text-cyan-400">
                      {shareUrlFor(createSuccess)}
                    </code>
                    <button
                      onClick={() => handleCopyLink(createSuccess)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition"
                    >
                      {copiedSlug === createSuccess.slug ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-white/60" />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => { setShowCreateModal(false); setCreateSuccess(null); }}
                  className="w-full rounded-xl bg-cyan-400 py-3 font-bold text-black hover:bg-cyan-300 transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {createError && (
                  <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-300">
                    {createError}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">Recipient Address *</label>
                    <input
                      type="text"
                      value={createForm.receiver}
                      onChange={(e) => updateForm("receiver", e.target.value)}
                      placeholder="GXXXXXXXXX..."
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/20 focus:border-cyan-400/40 transition font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Amount *</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={createForm.amount}
                        onChange={(e) => updateForm("amount", e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="0.00"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/20 focus:border-cyan-400/40 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Token *</label>
                      <select
                        value={createForm.tokenAddress}
                        onChange={(e) => updateForm("tokenAddress", e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none focus:border-cyan-400/40 transition"
                      >
                        {TOKENS.map((t) => (
                          <option key={t} value={t} className="bg-[#1a1f27]">{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Duration *</label>
                      <select
                        value={createForm.duration}
                        onChange={(e) => updateForm("duration", e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none focus:border-cyan-400/40 transition"
                      >
                        {DURATION_PRESETS.map((p) => (
                          <option key={p.label} value={p.seconds} className="bg-[#1a1f27]">{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Expires In</label>
                      <select
                        value={createForm.expiresInDays}
                        onChange={(e) => updateForm("expiresInDays", e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none focus:border-cyan-400/40 transition"
                      >
                        <option value="7">7 days</option>
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="365">1 year</option>
                        <option value="">No expiry</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">Description (invoice note)</label>
                    <input
                      type="text"
                      value={createForm.description}
                      onChange={(e) => updateForm("description", e.target.value)}
                      placeholder="e.g. Invoice #42 — Consulting services"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/20 focus:border-cyan-400/40 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">Custom Message (shown to payer)</label>
                    <textarea
                      value={createForm.customMessage}
                      onChange={(e) => updateForm("customMessage", e.target.value)}
                      placeholder="e.g. Thank you for your business! Payment due within 30 days."
                      rows={2}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/20 focus:border-cyan-400/40 transition resize-none"
                    />
                  </div>
                </div>

                <button
                  onClick={handleCreateLink}
                  disabled={createLoading}
                  className="w-full rounded-xl bg-emerald-500 py-3 font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {createLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4" />
                      Create Payment Link
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-white/50">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading invoices…
        </div>
      )}
      {error && <p className="text-red-200">{error}</p>}

      {!loading && !error && unpaidInvoices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
          <Link2 className="mx-auto h-10 w-10 text-white/20 mb-3" />
          <p className="text-white/40">No payment links yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 transition"
          >
            <Plus className="h-4 w-4" />
            Create Your First Payment Link
          </button>
        </div>
      )}

      {!loading && !error && unpaidInvoices.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/70">
              <tr>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Token</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Actions</th>
                <th className="px-4 py-3">QR</th>
              </tr>
            </thead>
            <tbody>
              {unpaidInvoices.map((invoice) => {
                const isSelected = selectedIds.has(invoice.id);
                const qrOpen = qrOpenId === invoice.id;
                return (
                  <Fragment key={invoice.id}>
                    <tr className={`transition ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.02]"}`}>
                      <td className="px-4 py-3 font-mono text-xs text-white/85" title={invoice.receiver}>
                        {truncateAddress(invoice.receiver)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{invoice.amount}</td>
                      <td className="px-4 py-3 text-sm">{invoice.tokenAddress ?? "--"}</td>
                      <td className="px-4 py-3 text-xs text-white/50">{formatDuration(invoice.duration)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[invoice.status]}`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-white/50">
                          <Eye className="h-3 w-3" />
                          {invoice.viewCount ?? 0}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => addToSplitter(invoice)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                              isSelected
                                ? "bg-emerald-400 text-black"
                                : "bg-slate-700/70 text-white hover:bg-slate-600"
                            }`}
                            data-testid={`add-to-splitter-${invoice.id}`}
                          >
                            {isSelected ? "✓" : "+ Splitter"}
                          </button>
                          <button
                            onClick={() => handleCopyLink(invoice)}
                            className="rounded-lg p-1 text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition"
                            title="Copy link"
                          >
                            {copiedSlug === invoice.slug ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleQr(invoice.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                            qrOpen
                              ? "bg-cyan-400 text-black"
                              : "bg-slate-700/70 text-white hover:bg-slate-600"
                          }`}
                          data-testid={`toggle-qr-${invoice.id}`}
                        >
                          <QrCode className="h-3.5 w-3.5" />
                          {qrOpen ? "Hide QR" : "Show QR"}
                        </button>
                      </td>
                    </tr>
                    {qrOpen && (
                      <tr>
                        <td colSpan={8} className="bg-black/20 px-4 py-6">
                          <div className="max-w-sm">
                            <QRStudio url={shareUrlFor(invoice)} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* All invoices (including completed/expired) */}
      {!loading && !error && invoices.length > unpaidInvoices.length && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <summary className="px-6 py-3 text-sm text-white/50 cursor-pointer hover:text-white/70 transition">
            Show all links ({invoices.length} total, {unpaidInvoices.length} active)
          </summary>
          <div className="border-t border-white/[0.05] overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-white/60">
                <tr>
                  <th className="px-4 py-2">Recipient</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Views</th>
                  <th className="px-4 py-2">Last Viewed</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {invoices
                  .filter((inv) => !UNPAID_STATUSES.includes(inv.status))
                  .map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-2 font-mono text-xs text-white/60">{truncateAddress(invoice.receiver)}</td>
                      <td className="px-4 py-2 text-xs text-white/60">{invoice.amount} {invoice.tokenAddress}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[invoice.status]}`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-white/40">
                        <div className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />{invoice.viewCount ?? 0}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-white/30">
                        {invoice.lastViewedAt ? new Date(invoice.lastViewedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-white/30">
                        {new Date(invoice.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {bundleMessage && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/50 p-4">
          <p className={bundleStatus === "error" ? "text-red-300" : "text-green-200"}>{bundleMessage}</p>
          {bundleResult && (
            <div className="text-xs text-slate-200">
              <p>Total rows: {bundleResult.totalRows}</p>
              <p>Valid recipients: {bundleResult.valid.length}</p>
              <p>Errors: {bundleResult.errors.length}</p>
            </div>
          )}
        </div>
      )}

      {selectedInvoices.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="font-semibold">Splitter payload preview</p>
          <ul className="mt-2 space-y-1 max-h-44 overflow-y-auto">
            {selectedInvoices.map((invoice) => (
              <li key={invoice.id} className="flex justify-between text-xs">
                <span>{truncateAddress(invoice.receiver)}</span>
                <span>{invoice.amount} {invoice.tokenAddress}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

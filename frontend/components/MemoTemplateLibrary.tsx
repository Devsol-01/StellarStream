"use client";
// frontend/components/MemoTemplateLibrary.tsx
// Issue #1366 — Payment Memo Templates
//
// Browse/create/edit/delete memo templates, fill in variables, and
// copy the substituted memo text. Import/export for portability.

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Plus,
  Copy,
  Trash2,
  Pencil,
  X,
  CheckCircle2,
  Download,
  Upload,
} from "lucide-react";
import { useMemoTemplates, type CreateMemoTemplateInput } from "@/lib/use-memo-templates";
import {
  MEMO_TEMPLATE_CATEGORIES,
  MEMO_VARIABLES,
  extractVariables,
  substituteVariables,
  type MemoTemplate,
  type MemoTemplateCategory,
} from "@/lib/memo-templates";

const EMPTY_FORM: CreateMemoTemplateInput = {
  name: "",
  category: "General",
  body: "",
};

function VariableChips({ body }: { body: string }) {
  const vars = extractVariables(body);
  if (vars.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <span
          key={v}
          className="rounded-full border border-[#00f5ff]/20 bg-[#00f5ff]/10 px-2 py-0.5 font-ticker text-[10px] text-[#00f5ff]"
        >
          {`{{${v}}}`}
        </span>
      ))}
    </div>
  );
}

function UsePanel({
  template,
  onClose,
  onUse,
}: {
  template: MemoTemplate;
  onClose: () => void;
  onUse: (id: string) => void;
}) {
  const variables = useMemo(() => extractVariables(template.body), [template.body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const preview = substituteVariables(template.body, values);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      onUse(template.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — no-op.
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3"
    >
      {variables.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {variables.map((key) => {
            const meta = MEMO_VARIABLES.find((v) => v.key === key);
            return (
              <div key={key}>
                <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  {meta?.label ?? key}
                </p>
                <input
                  type="text"
                  value={values[key] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={meta?.example ?? key}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-body text-xs text-white placeholder-white/25 outline-none focus:border-cyan-400/50"
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">Preview</p>
      <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-ticker text-xs text-white/80 break-words">
        {preview || <span className="text-white/30">Empty template</span>}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-cyan-300"
        >
          <Copy className="h-3 w-3" /> {copied ? "Copied ✓" : "Copy Memo"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-white/50 transition hover:bg-white/5"
        >
          Close
        </button>
      </div>
    </motion.div>
  );
}

function MemoTemplateCard({
  template,
  onDuplicate,
  onDelete,
  onEdit,
  onUse,
}: {
  template: MemoTemplate;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onUse: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [using, setUsing] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      className="glass-card p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold text-white">{template.name}</p>
          <p className="font-body text-xs text-white/40 mt-0.5">
            {template.category} · Used {template.usageCount}×
          </p>
        </div>
        {template.isDefault && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-ticker text-[10px] text-white/40">
            Built-in
          </span>
        )}
      </div>

      <p className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 font-ticker text-xs text-white/60 break-words">
        {template.body}
      </p>

      <VariableChips body={template.body} />

      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => setUsing((v) => !v)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#00f5ff]/25 bg-[#00f5ff]/10 py-2 text-xs font-semibold text-[#00f5ff] transition hover:bg-[#00f5ff]/20"
        >
          <FileText className="h-3.5 w-3.5" /> Use
        </button>
        {!template.isDefault && (
          <button
            onClick={onEdit}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50 transition hover:text-white hover:bg-white/10"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={onDuplicate}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50 transition hover:text-white hover:bg-white/10"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {!template.isDefault && (
          <button
            onClick={() => {
              if (confirmDelete) {
                onDelete();
              } else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
              }
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition ${
              confirmDelete
                ? "border-red-500/40 bg-red-500/15 text-red-400"
                : "border-white/10 bg-white/5 text-white/50 hover:text-red-400 hover:border-red-500/30"
            }`}
          >
            {confirmDelete ? (
              <>
                <Trash2 className="h-3.5 w-3.5" /> Confirm
              </>
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      <AnimatePresence>
        {using && (
          <UsePanel template={template} onClose={() => setUsing(false)} onUse={onUse} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function MemoTemplateLibrary() {
  const {
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    recordUsage,
    exportTemplates,
    importTemplates,
  } = useMemoTemplates();

  const [activeCategory, setActiveCategory] = useState<MemoTemplateCategory | "All">("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateMemoTemplateInput>(EMPTY_FORM);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () => (activeCategory === "All" ? templates : templates.filter((t) => t.category === activeCategory)),
    [templates, activeCategory],
  );

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (t: MemoTemplate) => {
    setEditingId(t.id);
    setForm({ name: t.name, category: t.category, body: t.body });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.body.trim()) return;
    if (editingId) {
      updateTemplate(editingId, form);
    } else {
      createTemplate(form);
    }
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleExport = () => {
    const blob = new Blob([exportTemplates()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memo-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const result = importTemplates(text);
    if (result.error) {
      setImportMessage(result.error);
    } else {
      setImportMessage(`Imported ${result.imported} template${result.imported === 1 ? "" : "s"}.`);
    }
    setTimeout(() => setImportMessage(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory("All")}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
              activeCategory === "All"
                ? "border-[#00f5ff]/40 bg-[#00f5ff]/10 text-[#00f5ff]"
                : "border-white/10 bg-white/5 text-white/40 hover:text-white"
            }`}
          >
            All
          </button>
          {MEMO_TEMPLATE_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                activeCategory === c
                  ? "border-[#00f5ff]/40 bg-[#00f5ff]/10 text-[#00f5ff]"
                  : "border-white/10 bg-white/5 text-white/40 hover:text-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition hover:bg-white/10"
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            onClick={() => (showForm ? setShowForm(false) : startCreate())}
            className="flex items-center gap-2 rounded-xl border border-[#8a00ff]/30 bg-[#8a00ff]/10 px-4 py-2 text-xs font-semibold text-[#c084fc] transition hover:bg-[#8a00ff]/20"
          >
            {showForm ? (
              <>
                <X className="h-3.5 w-3.5" /> Cancel
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> New Template
              </>
            )}
          </button>
        </div>
      </div>

      {importMessage && (
        <p className="font-body text-xs text-white/50">{importMessage}</p>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-card p-5 space-y-4"
          >
            <p className="font-body text-xs font-medium uppercase tracking-widest text-white/30">
              {editingId ? "Edit Template" : "New Template"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  Template Name
                </p>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Freelancer Invoice"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-body text-sm text-white outline-none focus:border-[#8a00ff]/40 placeholder:text-white/20"
                />
              </div>
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  Category
                </p>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, category: e.target.value as MemoTemplateCategory }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-body text-sm text-white outline-none focus:border-[#8a00ff]/40"
                >
                  {MEMO_TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c} value={c} className="bg-[#0a0a1a]">
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">
                Memo Text — use {"{{variableName}}"} for placeholders
              </p>
              <textarea
                value={form.body}
                onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                placeholder="Invoice {{invoiceNumber}} - {{amount}} {{asset}}"
                rows={2}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-body text-sm text-white outline-none focus:border-[#8a00ff]/40 placeholder:text-white/20"
              />
              <div className="mt-2">
                <VariableChips body={form.body} />
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.body.trim()}
              className="flex items-center gap-2 rounded-xl bg-[#8a00ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7000dd] disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" /> {editingId ? "Save Changes" : "Save Template"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {visible.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-3 py-16 text-center">
          <FileText className="h-10 w-10 text-white/15" />
          <p className="font-body text-white/40">No templates in this category yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((t) => (
              <MemoTemplateCard
                key={t.id}
                template={t}
                onDuplicate={() => duplicateTemplate(t.id)}
                onDelete={() => deleteTemplate(t.id)}
                onEdit={() => startEdit(t)}
                onUse={recordUsage}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

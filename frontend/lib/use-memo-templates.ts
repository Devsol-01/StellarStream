"use client";
// frontend/lib/use-memo-templates.ts
// Issue #1366 — Payment Memo Templates
//
// localStorage-backed CRUD for the memo template library. Unlike stream
// templates (useTemplateLibrary), memo templates have no backend
// counterpart — they're purely a client-side convenience for composing
// payment memo text, so this hook is local-storage only.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DEFAULT_MEMO_TEMPLATES,
  type MemoTemplate,
  type MemoTemplateCategory,
} from "./memo-templates";

const KEY = "stellarstream_memo_templates";

function loadLocal(): MemoTemplate[] {
  if (typeof window === "undefined") return DEFAULT_MEMO_TEMPLATES;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MEMO_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_MEMO_TEMPLATES;
  } catch {
    return DEFAULT_MEMO_TEMPLATES;
  }
}

function saveLocal(templates: MemoTemplate[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(templates));
}

export interface CreateMemoTemplateInput {
  name: string;
  category: MemoTemplateCategory;
  body: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

export function useMemoTemplates() {
  const [templates, setTemplates] = useState<MemoTemplate[]>(DEFAULT_MEMO_TEMPLATES);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const existing = loadLocal();
    setTemplates(existing);
    // Seed storage on first-ever load so the defaults are visible/exportable
    // even before the user creates anything of their own.
    if (typeof window !== "undefined" && !localStorage.getItem(KEY)) {
      saveLocal(existing);
    }
  }, []);

  const createTemplate = useCallback((input: CreateMemoTemplateInput): MemoTemplate => {
    const template: MemoTemplate = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      category: input.category,
      body: input.body,
      isDefault: false,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    setTemplates((prev) => {
      const next = [template, ...prev];
      saveLocal(next);
      return next;
    });
    return template;
  }, []);

  const updateTemplate = useCallback(
    (id: string, patch: Partial<CreateMemoTemplateInput>) => {
      setTemplates((prev) => {
        const next = prev.map((t) =>
          t.id === id && !t.isDefault ? { ...t, ...patch } : t,
        );
        saveLocal(next);
        return next;
      });
    },
    [],
  );

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target || target.isDefault) return prev; // defaults are protected
      const next = prev.filter((t) => t.id !== id);
      saveLocal(next);
      return next;
    });
  }, []);

  const duplicateTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const src = prev.find((t) => t.id === id);
      if (!src) return prev;
      const copy: MemoTemplate = {
        ...src,
        id: crypto.randomUUID(),
        name: `${src.name} (copy)`,
        isDefault: false,
        usageCount: 0,
        createdAt: new Date().toISOString(),
      };
      const next = [copy, ...prev];
      saveLocal(next);
      return next;
    });
  }, []);

  const recordUsage = useCallback((id: string) => {
    setTemplates((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, usageCount: (t.usageCount ?? 0) + 1 } : t,
      );
      saveLocal(next);
      return next;
    });
  }, []);

  const exportTemplates = useCallback((): string => {
    return JSON.stringify(templates, null, 2);
  }, [templates]);

  const importTemplates = useCallback((json: string): ImportResult => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { imported: 0, skipped: 0, error: "Invalid JSON" };
    }

    if (!Array.isArray(parsed)) {
      return { imported: 0, skipped: 0, error: "Expected a JSON array of templates" };
    }

    const incoming = parsed.filter(
      (t): t is MemoTemplate =>
        !!t &&
        typeof t === "object" &&
        typeof (t as MemoTemplate).name === "string" &&
        typeof (t as MemoTemplate).body === "string" &&
        typeof (t as MemoTemplate).category === "string",
    );
    const skipped = parsed.length - incoming.length;

    if (incoming.length === 0) {
      return { imported: 0, skipped, error: skipped > 0 ? "No valid templates found" : undefined };
    }

    setTemplates((prev) => {
      // Always mint fresh ids on import so we never clobber an existing
      // template (local or default) that happens to share an id.
      const imported = incoming.map((t) => ({
        ...t,
        id: crypto.randomUUID(),
        isDefault: false,
        usageCount: 0,
        createdAt: new Date().toISOString(),
      }));
      const next = [...imported, ...prev];
      saveLocal(next);
      return next;
    });

    return { imported: incoming.length, skipped };
  }, []);

  return {
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    recordUsage,
    exportTemplates,
    importTemplates,
  };
}

import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMemoTemplates } from "@/lib/use-memo-templates";
import { DEFAULT_MEMO_TEMPLATES } from "@/lib/memo-templates";

describe("useMemoTemplates", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("seeds the default template library on first load", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThanOrEqual(10));
    expect(result.current.templates.every((t) => t.isDefault)).toBe(true);
  });

  it("creates a custom template and persists it to localStorage", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    act(() => {
      result.current.createTemplate({ name: "My Template", category: "General", body: "{{a}}" });
    });

    await waitFor(() =>
      expect(result.current.templates.some((t) => t.name === "My Template")).toBe(true),
    );

    const created = result.current.templates.find((t) => t.name === "My Template")!;
    expect(created.isDefault).toBe(false);
    expect(created.usageCount).toBe(0);

    const stored = JSON.parse(localStorage.getItem("stellarstream_memo_templates") ?? "[]");
    expect(stored.some((t: { name: string }) => t.name === "My Template")).toBe(true);
  });

  it("does not delete a default template", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const before = result.current.templates.length;
    const defaultTemplate = result.current.templates.find((t) => t.isDefault)!;

    act(() => {
      result.current.deleteTemplate(defaultTemplate.id);
    });

    expect(result.current.templates.length).toBe(before);
    expect(result.current.templates.some((t) => t.id === defaultTemplate.id)).toBe(true);
  });

  it("deletes a custom template", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    let createdId = "";
    act(() => {
      createdId = result.current.createTemplate({ name: "Deletable", category: "General", body: "{{a}}" }).id;
    });
    await waitFor(() => expect(result.current.templates.some((t) => t.id === createdId)).toBe(true));

    act(() => {
      result.current.deleteTemplate(createdId);
    });

    await waitFor(() => expect(result.current.templates.some((t) => t.id === createdId)).toBe(false));
  });

  it("does not modify a default template via updateTemplate", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const defaultTemplate = result.current.templates.find((t) => t.isDefault)!;
    const originalBody = defaultTemplate.body;

    act(() => {
      result.current.updateTemplate(defaultTemplate.id, { body: "tampered" });
    });

    const stillDefault = result.current.templates.find((t) => t.id === defaultTemplate.id)!;
    expect(stillDefault.body).toBe(originalBody);
  });

  it("updates a custom template", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    let createdId = "";
    act(() => {
      createdId = result.current.createTemplate({ name: "Editable", category: "General", body: "old" }).id;
    });
    await waitFor(() => expect(result.current.templates.some((t) => t.id === createdId)).toBe(true));

    act(() => {
      result.current.updateTemplate(createdId, { body: "new" });
    });

    await waitFor(() =>
      expect(result.current.templates.find((t) => t.id === createdId)?.body).toBe("new"),
    );
  });

  it("duplicates a template as a non-default copy", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const source = result.current.templates.find((t) => t.isDefault)!;
    const beforeCount = result.current.templates.length;

    act(() => {
      result.current.duplicateTemplate(source.id);
    });

    await waitFor(() => expect(result.current.templates.length).toBe(beforeCount + 1));
    const copy = result.current.templates.find((t) => t.name === `${source.name} (copy)`);
    expect(copy).toBeDefined();
    expect(copy!.isDefault).toBe(false);
  });

  it("increments usageCount via recordUsage", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const target = result.current.templates[0];

    act(() => {
      result.current.recordUsage(target.id);
    });

    await waitFor(() =>
      expect(result.current.templates.find((t) => t.id === target.id)?.usageCount).toBe(
        (target.usageCount ?? 0) + 1,
      ),
    );
  });

  it("round-trips templates through exportTemplates/importTemplates", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const exported = result.current.exportTemplates();
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(result.current.templates.length);

    const beforeCount = result.current.templates.length;
    let importResult: { imported: number; skipped: number; error?: string } | undefined;
    act(() => {
      importResult = result.current.importTemplates(exported);
    });

    expect(importResult?.error).toBeUndefined();
    expect(importResult?.imported).toBe(beforeCount);
    await waitFor(() => expect(result.current.templates.length).toBe(beforeCount * 2));
  });

  it("importTemplates rejects invalid JSON", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    let importResult: { imported: number; skipped: number; error?: string } | undefined;
    act(() => {
      importResult = result.current.importTemplates("not json");
    });

    expect(importResult?.imported).toBe(0);
    expect(importResult?.error).toBeTruthy();
  });

  it("importTemplates skips malformed entries but imports valid ones", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(result.current.templates.length).toBeGreaterThan(0));

    const payload = JSON.stringify([
      { name: "Valid", category: "General", body: "{{a}}" },
      { name: "Missing body" },
    ]);

    let importResult: { imported: number; skipped: number; error?: string } | undefined;
    act(() => {
      importResult = result.current.importTemplates(payload);
    });

    expect(importResult?.imported).toBe(1);
    expect(importResult?.skipped).toBe(1);
  });

  it("persists custom templates across separate hook instances (simulated reload)", async () => {
    const first = renderHook(() => useMemoTemplates());
    await waitFor(() => expect(first.result.current.templates.length).toBeGreaterThan(0));

    act(() => {
      first.result.current.createTemplate({ name: "Persisted", category: "General", body: "{{a}}" });
    });
    await waitFor(() =>
      expect(first.result.current.templates.some((t) => t.name === "Persisted")).toBe(true),
    );
    first.unmount();

    const second = renderHook(() => useMemoTemplates());
    await waitFor(() =>
      expect(second.result.current.templates.some((t) => t.name === "Persisted")).toBe(true),
    );
  });

  it("has at least 10 default templates available on a fresh hook instance", async () => {
    const { result } = renderHook(() => useMemoTemplates());
    await waitFor(() =>
      expect(result.current.templates.filter((t) => t.isDefault).length).toBe(
        DEFAULT_MEMO_TEMPLATES.length,
      ),
    );
    expect(DEFAULT_MEMO_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });
});

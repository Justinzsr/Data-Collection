"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

type CredentialField = {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  type?: "text" | "password" | "url" | "select";
  placeholder?: string;
};

type SavedCredential = {
  field_key: string;
  value_hint: string | null;
  created_at: string;
  updated_at: string;
};

export function CredentialForm({ sourceId, title = "Credentials" }: { sourceId: string; title?: string }) {
  const [fields, setFields] = useState<CredentialField[]>([]);
  const [saved, setSaved] = useState<SavedCredential[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const savedByKey = useMemo(() => new Map(saved.map((item) => [item.field_key, item])), [saved]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sources/${sourceId}/credentials`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load credentials.");
      setFields(body.fields ?? []);
      setSaved(body.saved ?? []);
    } catch (error) {
      toast.error("Credentials unavailable", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/sources/${sourceId}/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: values }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save credentials.");
      setSaved(body.saved ?? []);
      setValues({});
      toast.success("Credentials saved", { description: "Secrets are encrypted server-side and only masked hints are returned." });
    } catch (error) {
      toast.error("Could not save credentials", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(fieldKey: string) {
    const response = await fetch(`/api/sources/${sourceId}/credentials/${encodeURIComponent(fieldKey)}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      toast.error("Could not remove credential", { description: body.error ?? "Unknown error" });
      return;
    }
    await load();
    toast.success("Credential removed");
  }

  if (loading) {
    return <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Loading credential fields...</div>;
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/8 p-4 text-sm leading-6 text-cyan-50">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <Check className="h-4 w-4" />
          No API credentials required
        </div>
        This source is configured through webhooks, tracking snippets, or demo mode.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <KeyRound className="h-4 w-4 text-cyan-200" />
          {title}
        </h3>
        <Badge tone="amber">server encrypted</Badge>
      </div>
      <div className="grid gap-3">
        {fields.map((field) => {
          const savedItem = savedByKey.get(field.key);
          return (
            <label key={field.key} className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-100">
                  {field.label} {field.required ? <span className="text-amber-200">*</span> : null}
                </span>
                {savedItem ? <Badge tone="green">{savedItem.value_hint ?? "saved"}</Badge> : <Badge tone={field.required ? "amber" : "slate"}>{field.required ? "required" : "optional"}</Badge>}
              </div>
              <span className="text-xs leading-5 text-slate-500">{field.description}</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type={field.secret ? "password" : field.type ?? "text"}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={savedItem ? "Leave blank to keep existing value" : field.placeholder ?? field.label}
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none ring-cyan-300/30 transition placeholder:text-slate-600 focus:ring-2"
                />
                {savedItem ? (
                  <Button type="button" variant="danger" className="px-3" onClick={() => remove(field.key)} aria-label={`Delete ${field.label}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
      <Button onClick={save} disabled={saving || Object.values(values).every((value) => !value.trim())} variant="primary" className="w-full sm:w-fit">
        <KeyRound className="h-4 w-4" />
        {saving ? "Saving..." : "Save Credentials"}
      </Button>
    </div>
  );
}

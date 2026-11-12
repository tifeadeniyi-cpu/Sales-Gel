"use client";
import Link from "next/link";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ImportField, ImportReport } from "@/domains/customers/import-export";
import { previewImportAction, runImportAction } from "../actions";

type Preview = { headers: string[]; sample: string[][]; rowCount: number; mapping: ImportField[]; customFields: { key: string; label: string }[] };

export function ImportWizard({ orgSlug, fields, maxRows, maxBytes }: { orgSlug: string; fields: Record<string, string>; maxRows: number; maxBytes: number }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, start] = useTransition();
  const base = `/o/${orgSlug}/customers`;

  const load = (file: File) => {
    setError(null);
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") { setError("Choose a .csv file."); return; }
    if (file.size > maxBytes) { setError(`File is too large (max ${maxBytes / 1024 / 1024} MB).`); return; }
    void file.text().then((text) => {
      setCsv(text);
      setFileName(file.name);
      start(async () => {
        const res = await previewImportAction(orgSlug, text);
        if (res.ok) { setPreview(res.data); setMapping(res.data.mapping); } else setError(res.error);
      });
    });
  };

  if (report) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" /> Import finished</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[["Created", report.created], ["Updated", report.updated], ["Skipped (already existed)", report.skipped], ["Failed", report.failed.length]].map(([l, v]) => (
              <div key={l as string} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{v}</div></div>
            ))}
          </div>
          {report.failed.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Rows that weren&apos;t imported</h3>
              <Table>
                <THead><TR><TH>Row</TH><TH>Problem</TH></TR></THead>
                <TBody>{report.failed.slice(0, 200).map((f) => <TR key={f.row}><TD>{f.row}</TD><TD className="text-danger">{f.error}</TD></TR>)}</TBody>
              </Table>
            </div>
          )}
          <div className="flex gap-2">
            <Button asChild><Link href={`${base}?sort=created_desc`}>View customers</Link></Button>
            <Button variant="outline" onClick={() => { setReport(null); setPreview(null); setCsv(null); }}>Import another file</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="pt-5">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center ${dragOver ? "border-primary bg-primary/5" : ""}`}
          >
            <FileUp className="size-8 text-muted-foreground" aria-hidden />
            <span className="font-medium">{pending ? "Reading file…" : "Drop a CSV file here or click to browse"}</span>
            <span className="text-xs text-muted-foreground">Up to {maxRows.toLocaleString()} rows · {maxBytes / 1024 / 1024} MB · first row must be column headers</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); }} />
          </label>
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const options: [string, string][] = [...Object.entries(fields), ...preview.customFields.map((c) => [`custom:${c.key}`, `Custom: ${c.label}`] as [string, string])];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Map columns</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">{fileName} · {preview.rowCount.toLocaleString()} rows. Check how each column should be imported.</p>
          <Table>
            <THead><TR><TH>Column in file</TH><TH>Sample</TH><TH>Import as</TH></TR></THead>
            <TBody>
              {preview.headers.map((h, i) => (
                <TR key={i}>
                  <TD className="font-medium">{h || <span className="text-muted-foreground">(blank header)</span>}</TD>
                  <TD className="max-w-xs truncate text-xs text-muted-foreground">{preview.sample.map((r) => r[i]).filter(Boolean).slice(0, 2).join(" · ")}</TD>
                  <TD>
                    <NativeSelect aria-label={`Import ${h} as`} className="h-8 w-56" value={mapping[i]} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? (e.target.value as ImportField) : m)))}>
                      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </NativeSelect>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>When a row matches an existing customer</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {([
            ["skip", "Skip it", "Leave the existing customer unchanged."],
            ["update", "Add missing details", "Fill empty fields and add new emails, phones, handles and tags. Nothing is overwritten."],
            ["create", "Create a new customer anyway", "You can merge duplicates later."],
          ] as const).map(([v, l, d]) => (
            <label key={v} className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1 accent-[var(--brand-primary)]" />
              <span><span className="font-medium">{l}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
            </label>
          ))}
          <p className="mt-1 text-xs text-muted-foreground">Rows are matched by email, phone number or social handle.</p>
        </CardContent>
      </Card>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || !mapping.some((m) => m !== "skip")}
          onClick={() => start(async () => {
            const res = await runImportAction(orgSlug, csv!, mapping, mode);
            if (res.ok) setReport(res.data); else setError(res.error);
          })}
        >
          <Upload /> {pending ? `Importing ${preview.rowCount.toLocaleString()} rows…` : `Import ${preview.rowCount.toLocaleString()} rows`}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => { setPreview(null); setCsv(null); }}>Choose a different file</Button>
      </div>
    </div>
  );
}

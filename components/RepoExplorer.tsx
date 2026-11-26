'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderTree, Search } from 'lucide-react';

export interface RepoFileEntry {
  path: string;
  sizeBytes: number;
  category: string;
}

interface RepoExplorerProps {
  files: RepoFileEntry[];
  loadingList: boolean;
  listError: string | null;
  initialFile?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function RepoExplorer({
  files,
  loadingList,
  listError,
  initialFile = 'api/Dockerfile',
}: RepoExplorerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>(initialFile);
  const [loadedPath, setLoadedPath] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [fileMeta, setFileMeta] = useState<{ sizeBytes: number; category: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadingFile = Boolean(selectedPath) && loadedPath !== selectedPath && !fileError;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(f.category);
    return ['ALL', ...Array.from(set)];
  }, [files]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      if (selectedCategory !== 'ALL' && f.category !== selectedCategory) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, selectedCategory, searchQuery]);

  useEffect(() => {
    if (!selectedPath) return;
    let active = true;

    fetch(`/api/repo?file=${encodeURIComponent(selectedPath)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to read file');
        return data;
      })
      .then((data) => {
        if (!active) return;
        setFileError(null);
        setFileContent(data.content || '');
        setFileMeta({ sizeBytes: data.sizeBytes || 0, category: data.category || '' });
        setLoadedPath(selectedPath);
      })
      .catch((err) => {
        if (!active) return;
        setFileError(err.message || 'Unable to load file');
        setLoadedPath(selectedPath);
      });

    return () => {
      active = false;
    };
  }, [selectedPath]);

  const handleCopy = async () => {
    if (!fileContent) return;
    try {
      await navigator.clipboard.writeText(fileContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleDownloadFile = () => {
    if (!fileContent || !selectedPath) return;
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedPath.split('/').pop() || 'file.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <aside className="flex flex-col rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="border-b border-[#E5E7EB] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <FolderTree className="h-4 w-4 text-[#14532D]" />
              <span>mujahi-chess-engine/</span>
            </div>
            <span className="font-mono text-xs text-[#6B7280]">{filteredFiles.length} files</span>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter path (e.g. analyze, sse, doc)"
              className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] pl-8 pr-3 text-xs text-[#111827] placeholder-[#9CA3AF] focus:border-[#14532D] focus:outline-none"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="Filter by component category"
            className="h-9 w-full rounded-md border border-[#D1D5DB] bg-[#FAF9F6] px-2.5 text-xs text-[#111827] focus:border-[#14532D] focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'ALL' ? 'All Repository Components' : cat}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-[540px] overflow-y-auto p-2 space-y-0.5">
          {loadingList && (
            <div className="p-3 text-xs text-[#6B7280]">Indexing repository files...</div>
          )}
          {listError && (
            <div className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
              {listError}
            </div>
          )}
          {!loadingList &&
            !listError &&
            filteredFiles.map((file) => {
              const isSelected = file.path === selectedPath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-[#ECFDF5] font-medium text-[#14532D]'
                      : 'text-[#374151] hover:bg-[#FAF9F6]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    <span className="truncate font-mono">{file.path}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[#9CA3AF]">
                    {formatBytes(file.sizeBytes)}
                  </span>
                </button>
              );
            })}
        </div>
      </aside>

      <section className="flex flex-col rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#FAF9F6] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs sm:text-sm font-semibold text-[#111827]">
              {selectedPath}
            </div>
            {fileMeta && (
              <div className="mt-0.5 font-mono text-[11px] text-[#6B7280]">
                {fileMeta.category} · {formatBytes(fileMeta.sizeBytes)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!fileContent}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 text-xs font-medium text-[#111827] hover:border-[#14532D] disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#16A34A]" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadFile}
              disabled={!fileContent}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 text-xs font-medium text-[#111827] hover:border-[#14532D] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        <div className="max-h-[600px] overflow-auto bg-[#FAF9F6] p-4">
          {loadingFile ? (
            <div className="font-mono text-xs text-[#6B7280]">Loading source file...</div>
          ) : fileError ? (
            <div className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
              {fileError}
            </div>
          ) : (
            <pre className="font-mono text-xs leading-relaxed text-[#1F2937] whitespace-pre">
              {fileContent}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}

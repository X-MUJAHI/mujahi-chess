'use client';

import { useState } from 'react';
import { Crown, FolderGit2, Menu, X } from 'lucide-react';

export type WorkspaceTab = 'overview' | 'explorer' | 'console' | 'extension' | 'deployment';

interface NavbarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  fileCount: number;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'explorer', label: 'Repo Explorer' },
  { id: 'console', label: 'Live API' },
  { id: 'extension', label: 'Extension 2.1.0' },
  { id: 'deployment', label: 'Deployment' },
];

export default function Navbar({ activeTab, onSelectTab, fileCount }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSelect = (tab: WorkspaceTab) => {
    onSelectTab(tab);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#24303F] bg-[#0B0F14]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => handleSelect('overview')}
          className="flex items-center gap-2.5 text-left font-semibold tracking-tight text-[#F1F5F9] cursor-pointer"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[#22C55E]/40 bg-[#22C55E]/10 text-[#4ADE80]">
            <Crown className="h-4 w-4" />
          </span>
          <span className="text-sm sm:text-base" style={{ fontFamily: 'var(--font-display)' }}>
            MUJAHI Chess Engine
          </span>
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Workspace views">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#22C55E]/15 text-[#4ADE80]'
                    : 'text-[#94A3B8] hover:bg-[#131920] hover:text-[#F1F5F9]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSelect('explorer')}
            className="hidden cursor-pointer items-center gap-2 rounded-md bg-[#22C55E] px-3.5 py-1.5 text-xs font-semibold text-[#05130A] transition-colors hover:bg-[#4ADE80] sm:inline-flex"
          >
            <FolderGit2 className="h-3.5 w-3.5" />
            <span className="font-mono">{fileCount > 0 ? `${fileCount} Files` : 'Browse Repo'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[#24303F] bg-[#131920] text-[#F1F5F9] md:hidden"
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-[#24303F] bg-[#0B0F14] px-4 py-3 md:hidden">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`cursor-pointer rounded-md px-3 py-2 text-left text-sm font-medium ${
                  active
                    ? 'bg-[#22C55E]/15 text-[#4ADE80]'
                    : 'text-[#94A3B8] hover:bg-[#131920] hover:text-[#F1F5F9]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}

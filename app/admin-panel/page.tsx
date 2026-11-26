import type { Metadata } from 'next';
import AdminPortal from '@/components/AdminPortal';
import { isAdminServerSession } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin Portal — Mujahi Chess',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPanelPage() {
  const authenticated = await isAdminServerSession();
  return <AdminPortal initialAuthenticated={authenticated} />;
}

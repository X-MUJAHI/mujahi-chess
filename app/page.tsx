import LandingPage from '@/components/LandingPage';
import { getPublicDownloadConfig } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const initialConfig = await getPublicDownloadConfig();
  return <LandingPage initialConfig={initialConfig} />;
}

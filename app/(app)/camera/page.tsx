import type { Metadata } from 'next';
import { CameraEntry } from './camera-entry';

export const metadata: Metadata = {
  title: 'レシートカメラ',
  manifest: '/camera.webmanifest',
  icons: { apple: '/receipt-camera-192.png' },
  appleWebApp: { capable: true, title: 'レシートカメラ', statusBarStyle: 'black-translucent' },
};

export default function CameraPage() {
  return <CameraEntry />;
}

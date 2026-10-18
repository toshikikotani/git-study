'use server';

import { revalidatePath } from 'next/cache';

import type { SplitPaymentEntry } from '@/domain/split-payment-request';
import {
  deleteSplitPaymentTracking,
  importBrowserSplitPaymentTracking,
  loadSplitPaymentTracking,
  saveSplitPaymentTracking,
  updateSplitPaymentReceived,
} from '@/features/split-payments/store';
import type { TrackedSplitPayment } from '@/features/split-payments/types';

export async function loadSplitPaymentTrackingAction() {
  return loadSplitPaymentTracking();
}

export async function saveSplitPaymentTrackingAction(input: {
  entries: readonly SplitPaymentEntry[];
  participants: number;
}) {
  const result = await saveSplitPaymentTracking(input);
  if (!result.error) revalidatePath('/');
  return result;
}

export async function updateSplitPaymentReceivedAction(input: {
  id: string;
  expectedVersion: number;
  receivedCount: number;
}) {
  const result = await updateSplitPaymentReceived(input);
  if (!result.error) revalidatePath('/');
  return result;
}

export async function deleteSplitPaymentTrackingAction(input: {
  id: string;
  expectedVersion: number;
}) {
  const result = await deleteSplitPaymentTracking(input);
  if (!result.error) revalidatePath('/');
  return result;
}

export async function importBrowserSplitPaymentTrackingAction(
  requests: readonly TrackedSplitPayment[],
) {
  const result = await importBrowserSplitPaymentTracking(requests);
  if (!result.error && result.storage === 'database') revalidatePath('/');
  return result;
}

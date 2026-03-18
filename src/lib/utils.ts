import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSinhalaDate(dateStr: string) {
  // Simple Sinhala date formatter
  const date = new Date(dateStr);
  return date.toLocaleDateString('si-LK', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function getReminderIcon(type: string) {
  switch (type) {
    case 'payment': return 'CreditCard';
    case 'birthday': return 'Cake';
    case 'appointment': return 'CalendarClock';
    case 'special': return 'Star';
    default: return 'CheckCircle2';
  }
}

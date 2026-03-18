export interface Reminder {
  id?: number;
  title: string;
  date: string;
  time?: string;
  type: 'payment' | 'birthday' | 'appointment' | 'task' | 'special';
  repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  remind_before: number;
  notes?: string;
  priority: 'low' | 'normal' | 'high';
  tags?: string;
  share_to?: string;
  is_special: boolean;
  is_pinned: boolean;
  voice_data?: string;
  created_at?: string;
}

export interface ParsedCommand {
  title?: string;
  date?: string;
  time?: string;
  type?: Reminder['type'];
  repeat?: Reminder['repeat'];
  remind_before?: number;
  priority?: Reminder['priority'];
  is_special?: boolean;
  share_to?: string;
  query?: 'today' | 'week' | 'payments' | 'birthdays' | 'special';
}

# Voice Reminder LK

A modern, voice-controlled reminder application designed for Sri Lankans.

## Features
- **Voice Commands**: Add reminders by speaking in Sinhala or English.
- **Smart Parsing**: Automatically extracts dates, times, and categories (Leasing, Insurance, Birthdays).
- **Local Storage**: Uses SQLite to keep your data safe on the server.
- **WhatsApp Integration**: Share reminders directly to contacts.
- **Special Events**: Highlight and pin important events.
- **Timezone**: Always synced to Asia/Colombo.

## Setup
1. The app uses the **Gemini API** for voice command parsing. Ensure your `GEMINI_API_KEY` is set in the environment.
2. Run `npm install` (handled automatically in AI Studio).
3. Run `npm run dev` to start the application.

## Sample Voice Commands
- "ලීසින් ගෙවීම මාර්තු 5 දා උදේ 9ට මතක් කරන්න"
- "Insurance payment next Monday at 10 AM"
- "අම්මාගේ birthday ජූලි 14"
- "විශේෂ සිදුවීමක්: site visit පෙබරවාරි 28 හවස 4ට"
- "Show me today's tasks" (අද තියෙන දේවල් පෙන්නන්න)

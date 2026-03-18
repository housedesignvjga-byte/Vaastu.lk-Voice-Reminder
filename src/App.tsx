import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Mic, 
  Plus, 
  Search, 
  Calendar, 
  Star, 
  Settings as SettingsIcon, 
  Bell, 
  Share2, 
  Trash2, 
  Pin, 
  Edit2,
  Lock,
  Unlock,
  CheckCircle2, 
  CreditCard, 
  Cake, 
  CalendarClock,
  X,
  MapPin,
  Phone,
  MessageSquare,
  Check,
  DraftingCompass,
  Home as HomeIcon,
  SearchCode,
  Ruler,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { Reminder, ParsedCommand } from './types';
import { format, isToday, isTomorrow, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  orderBy,
  getDoc,
  setDoc
} from 'firebase/firestore';

// --- Components ---

const IconMap: Record<string, React.ElementType> = {
  payment: CreditCard,
  birthday: Cake,
  appointment: CalendarClock,
  special: Star,
  task: CheckCircle2,
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<{ username: string, language: string, isSubscribed: boolean } | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'special' | 'calendar' | 'settings' | 'vaastu'>('home');
  const [isParsing, setIsParsing] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<Reminder | null>(null);
  const [editingReminder, setEditingReminder] = useState<Partial<Reminder> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState<'si' | 'en'>('si');
  const [installDate] = useState(() => {
    const saved = localStorage.getItem('app_install_date');
    if (saved) return new Date(saved);
    const now = new Date();
    localStorage.setItem('app_install_date', now.toISOString());
    return now;
  });
  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('app_subscribed') === 'true');

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const recognitionRef = useRef<any>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const trialExpiryDate = new Date(installDate);
  trialExpiryDate.setMonth(trialExpiryDate.getMonth() + 3);
  const isTrialExpired = new Date() > trialExpiryDate && !isSubscribed;

  const handlePayment = () => {
    // In a real app, this would call a payment gateway like Stripe or a local SL gateway
    alert(language === 'si' ? 'ගෙවීම් පද්ධතියට සම්බන්ධ වෙමින්... (රු. 500.00)' : 'Connecting to payment gateway... (Rs. 500.00)');
    
    // Simulating successful payment
    setTimeout(() => {
      localStorage.setItem('app_subscribed', 'true');
      setIsSubscribed(true);
      alert(language === 'si' ? 'ගෙවීම සාර්ථකයි! දැන් ඔබට වසරක් පුරා භාවිතා කළ හැක.' : 'Payment Successful! You can now use the app for a year.');
    }, 2000);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, authForm.email, authForm.password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, authForm.email, authForm.password);
        // Create user profile
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          username: authForm.email.split('@')[0],
          language: 'si',
          installDate: new Date().toISOString(),
          isSubscribed: false
        });
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Fetch user data
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            username: data.username,
            language: data.language || 'si',
            isSubscribed: data.isSubscribed || false
          });
          if (data.language) setLanguage(data.language as any);
          if (data.isSubscribed) setIsSubscribed(true);
        }

        // Subscribe to reminders
        const q = query(
          collection(db, 'reminders'),
          where('userId', '==', firebaseUser.uid),
          orderBy('is_pinned', 'desc'),
          orderBy('createdAt', 'desc')
        );

        const unsubscribeReminders = onSnapshot(q, (snapshot) => {
          const reminderList: Reminder[] = [];
          snapshot.forEach((doc) => {
            reminderList.push({ id: doc.id as any, ...doc.data() } as Reminder);
          });
          setReminders(reminderList);
        }, (error) => {
          console.error("Firestore error:", error);
        });

        return () => unsubscribeReminders();
      } else {
        setReminders([]);
        setUserData(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // --- Notification Logic ---
  const checkNotifications = useCallback(() => {
    const now = new Date();
    const colomboTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
    const colomboTime = new Date(colomboTimeStr);
    
    reminders.forEach(reminder => {
      if (!reminder.id || !reminder.time) return;

      const [hours, minutes] = reminder.time.split(':').map(Number);
      const reminderDate = parseISO(reminder.date);
      reminderDate.setHours(hours, minutes, 0, 0);

      const diffInMs = reminderDate.getTime() - colomboTime.getTime();
      const diffInMinutes = Math.floor(diffInMs / 60000);

      // Check for exact time OR remind_before time
      const isDueNow = diffInMinutes === 0;
      const isDueBefore = reminder.remind_before > 0 && diffInMinutes === reminder.remind_before;

      if ((isDueNow || isDueBefore) && !notifiedRef.current.has(reminder.id + (isDueBefore ? '_before' : '_now'))) {
        setActiveAlarm(reminder);
        notifiedRef.current.add(reminder.id + (isDueBefore ? '_before' : '_now'));
        
        const title = isDueBefore 
          ? (language === 'si' ? `මතක් කිරීමක්! (තව විනාඩි ${reminder.remind_before}කින්)` : `Reminder! (in ${reminder.remind_before} mins)`)
          : (language === 'si' ? 'දැන් වේලාව හරි!' : 'It\'s time!');

        if (Notification.permission === 'granted') {
          new Notification(title, {
            body: reminder.title,
            icon: '/favicon.ico',
            requireInteraction: true
          });
        }
        
        // Play alarm sound
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const playTone = (freq: number, start: number, duration: number) => {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime + start);
            gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + start + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + start + duration);
            oscillator.start(audioCtx.currentTime + start);
            oscillator.stop(audioCtx.currentTime + start + duration);
          };
          playTone(880, 0, 0.3);
          playTone(880, 0.4, 0.3);
          playTone(880, 0.8, 0.3);
          playTone(1100, 1.2, 0.5);
        } catch (e) {}
      }
    });
  }, [reminders, language]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }

    const interval = setInterval(checkNotifications, 10000);
    return () => clearInterval(interval);
  }, [checkNotifications]);

  // --- Voice Recording Logic ---

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        
        // Convert to base64 to store in reminder
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          setEditingReminder(prev => prev ? { ...prev, voice_data: base64data } : null);
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
      alert('Microphone access denied or not supported.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const playVoice = (base64Data: string) => {
    const audio = new Audio(base64Data);
    audio.play().catch(e => console.error('Playback failed', e));
  };

  // --- Voice Logic ---

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition not supported in this browser. Please use Chrome or Safari.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language === 'si' ? 'si-LK' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
    };
    
    recognition.onresult = (event: any) => {
      const current = event.results[event.results.length - 1][0].transcript;
      setTranscript(current);
    };
    
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
    };
    
    recognition.onend = () => {
      setIsListening(false);
      if (transcript) {
        handleVoiceCommand(transcript);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const handleVoiceCommand = async (text: string) => {
    setIsParsing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const currentTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Parse the following voice command into a structured JSON reminder. 
        The current local time is ${currentTime} (Asia/Colombo).
        The command might be in Sinhala, English, or Singlish.
        
        Command: "${text}"
        
        Return JSON with these fields:
        - title: string (The main task/event name)
        - date: string (YYYY-MM-DD format)
        - time: string (HH:mm format, default to 09:00 if not specified)
        - type: "payment" | "birthday" | "appointment" | "task" | "special"
        - repeat: "none" | "daily" | "weekly" | "monthly" | "yearly"
        - remind_before: number (minutes before)
        - priority: "low" | "normal" | "high"
        - is_special: boolean
        - share_to: string (optional contact name/number)
        
        If the command asks to "share" or "send", set the share_to field.
        If the command is a query (e.g., "show me today's tasks"), return { "query": "today" | "week" | "payments" | "birthdays" | "special" }.`,
        config: {
          responseMimeType: "application/json",
          systemInstruction: "You are a precise parser for a reminder app in Sri Lanka. Extract dates and times accurately from Sinhala and English text."
        }
      });

      const parsed: ParsedCommand = JSON.parse(response.text || "{}");

      if (parsed.query) {
        if (parsed.query === 'special') setActiveTab('special');
        else if (parsed.query === 'today') setSearchQuery('today');
        else setSearchQuery(parsed.query);
      } else if (parsed.title) {
        setEditingReminder({
          title: parsed.title,
          date: parsed.date || format(new Date(), 'yyyy-MM-dd'),
          time: parsed.time || '09:00',
          type: parsed.type || 'task',
          repeat: parsed.repeat || 'none',
          remind_before: parsed.remind_before || 0,
          priority: parsed.priority || 'normal',
          is_special: parsed.is_special || false,
          share_to: parsed.share_to || '',
          is_pinned: false,
        });
      }
    } catch (err) {
      console.error('Parsing failed', err);
    } finally {
      setIsParsing(false);
      setTranscript('');
    }
  };

  const openManualAdd = () => {
    setEditingReminder({
      title: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      time: '09:00',
      type: 'task',
      repeat: 'none',
      remind_before: 0,
      priority: 'normal',
      is_special: false,
      share_to: '',
      is_pinned: false,
    });
  };

  // --- Actions ---

  const saveReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReminder || !user) return;

    try {
      const reminderData = {
        ...editingReminder,
        userId: user.uid,
        createdAt: editingReminder.id ? undefined : serverTimestamp(),
      };

      if (editingReminder.id) {
        const { id, ...updateData } = reminderData;
        await updateDoc(doc(db, 'reminders', id as any), updateData as any);
      } else {
        await addDoc(collection(db, 'reminders'), reminderData as any);
      }
      setEditingReminder(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteReminder = async (id: number) => {
    if (!confirm(language === 'si' ? 'ඔබට මෙය ඉවත් කිරීමට අවශ්‍ය බව විශ්වාසද?' : 'Are you sure you want to delete this?')) return;
    try {
      await deleteDoc(doc(db, 'reminders', id as any));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const togglePin = async (id: number, currentPinned: boolean) => {
    try {
      await updateDoc(doc(db, 'reminders', id as any), { is_pinned: !currentPinned });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleShare = (reminder: Reminder) => {
    const text = language === 'si' 
      ? `මතක් කිරීම: ${reminder.title}\nදිනය: ${reminder.date}\nවේලාව: ${reminder.time || 'N/A'}\nසටහන: ${reminder.notes || ''}`
      : `Reminder: ${reminder.title}\nDate: ${reminder.date}\nTime: ${reminder.time || 'N/A'}\nNotes: ${reminder.notes || ''}`;
    
    const url = `https://wa.me/${reminder.share_to?.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // --- Filtering & Views ---

  const renderVaastuServices = () => {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8 pb-20"
      >
        {/* Header Section */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-700 p-8 rounded-[2.5rem] text-white shadow-2xl shadow-emerald-500/20">
          <div className="absolute top-[-20%] right-[-10%] w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10">
            <h2 className="text-3xl font-black mb-1 font-display tracking-tight">J. Godakanda Arachchi</h2>
            <p className="text-emerald-100/80 font-bold uppercase tracking-[0.2em] text-[10px]">Vaastu Architect</p>
            <div className="mt-6 flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl w-fit border border-white/10">
              <div className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest">Professional Services</span>
            </div>
          </div>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 gap-4">
          {[
            { 
              title: 'Plan Drawing', 
              desc: 'Detailed architectural blueprints customized to your vision and land specifications.', 
              price: 'Rs. 30 / sq. ft.',
              icon: DraftingCompass,
              color: 'emerald'
            },
            { 
              title: 'House Inspection', 
              desc: 'Thorough structural and functional evaluation of existing residential buildings.', 
              price: 'Rs. 25,000 - 40,000',
              icon: HomeIcon,
              color: 'sky'
            },
            { 
              title: 'Plan Review', 
              desc: 'Expert audit and enhancement of existing plans for optimization and compliance.', 
              price: 'Rs. 15,000 - 20,000',
              icon: SearchCode,
              color: 'indigo'
            },
            { 
              title: 'Land Measurement', 
              desc: 'Precise surveying and data collection by our dedicated field professionals.', 
              price: 'Contact for Quote',
              icon: Ruler,
              color: 'amber'
            }
          ].map((service, idx) => (
            <div key={idx} className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem] backdrop-blur-sm group hover:border-emerald-500/30 transition-all">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "p-4 rounded-2xl shrink-0",
                  service.color === 'emerald' ? "bg-emerald-500/10 text-emerald-400" :
                  service.color === 'sky' ? "bg-sky-500/10 text-sky-400" :
                  service.color === 'indigo' ? "bg-indigo-500/10 text-indigo-400" :
                  "bg-amber-500/10 text-amber-400"
                )}>
                  <service.icon className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h4 className="text-white font-bold text-lg mb-1">{service.title}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed mb-4">{service.desc}</p>
                  <div className="inline-block px-4 py-1.5 bg-slate-950 rounded-xl border border-slate-800 text-emerald-400 font-black text-xs uppercase tracking-wider">
                    {service.price}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Transparent Pricing Note */}
        <div className="bg-slate-900/30 border border-dashed border-slate-800 p-6 rounded-3xl text-center">
          <p className="text-slate-400 text-xs font-medium italic">
            "We believe in honest, upfront pricing for all our architectural and engineering services."
          </p>
          <p className="text-emerald-500/60 text-[10px] font-bold uppercase tracking-widest mt-2">Transparent Pricing</p>
        </div>

        {/* Methodology Section */}
        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-[2.5rem] backdrop-blur-sm">
          <h3 className="text-xl font-bold text-white mb-8 flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            Our Methodology
          </h3>
          <div className="space-y-8 relative">
            <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-800" />
            {[
              { title: 'Call & Request', desc: 'Contact us via phone to request a service. We deploy a field specialist to your location.' },
              { title: 'Site Data Collection', desc: 'Our field team (5 experts) measures the land and inspects existing structures. Field fee (Rs. 3000-8000) is paid directly to them.' },
              { title: 'Digital Consultation', desc: 'Consultation via office visit or WhatsApp Video. We discuss your needs and initial design data.' },
              { title: 'Draft Design', desc: 'A draft sketch is provided. We iterate based on your feedback through calls or visits.' },
              { title: 'Final Print', desc: 'Final design is perfected by our office team and handed over with all technical details.' }
            ].map((step, idx) => (
              <div key={idx} className="relative pl-12">
                <div className="absolute left-0 top-0 w-8 h-8 bg-slate-900 border-2 border-slate-800 rounded-full flex items-center justify-center z-10">
                  <span className="text-[10px] font-black text-emerald-400">{idx + 1}</span>
                </div>
                <h4 className="text-white font-bold mb-1">{step.title}</h4>
                <p className="text-slate-400 text-xs leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Value Added Services */}
        <div className="bg-emerald-500/5 border border-emerald-500/10 p-8 rounded-[2.5rem]">
          <h3 className="text-lg font-bold text-emerald-400 mb-6 uppercase tracking-widest text-center">Value Added Services</h3>
          <div className="grid grid-cols-1 gap-3">
            {[
              'BOQ (Bill of Quantities) available on request',
              'Post-delivery plan modifications supported',
              'Convenient Online Payment Options',
              'Virtual Consultation via WhatsApp Video'
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-slate-900/30 p-4 rounded-2xl border border-white/5">
                <div className="bg-emerald-500 rounded-full p-1">
                  <Check className="w-3 h-3 text-white" />
                </div>
                <span className="text-slate-300 text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contact Section */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl">
          <h3 className="text-2xl font-bold text-white mb-2 font-display">Let's Discuss Your Project</h3>
          <p className="text-slate-400 text-sm mb-8">Ready to start your journey? Our team of field and office experts is standing by.</p>
          
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/10 rounded-xl text-rose-400">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Our Office</p>
                <p className="text-white font-medium">3rd lane, Piliyandala Rd, Maharagama.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Direct Lines</p>
                <div className="space-y-1">
                  <p className="text-white font-bold">0777 892 057</p>
                  <p className="text-white font-bold">0777 892 051</p>
                  <p className="text-white font-bold">0777 892 017</p>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">WhatsApp Consultation</p>
                <p className="text-white font-medium">Available for video calls and draft sharing.</p>
              </div>
            </div>
          </div>

          <button 
            onClick={() => window.open('tel:0777892057')}
            className="w-full mt-10 py-5 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            <Phone className="w-6 h-6" />
            Call Now
          </button>
        </div>
      </motion.div>
    );
  };

  const renderContent = () => {
    if (activeTab === 'vaastu') {
      return renderVaastuServices();
    }
    if (activeTab === 'settings') {
      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="bg-slate-900/50 p-6 rounded-[2.5rem] shadow-xl border border-slate-800 backdrop-blur-sm">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-3 text-white">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <SettingsIcon className="w-5 h-5 text-emerald-400" />
              </div>
              {language === 'si' ? 'සැකසුම්' : 'Settings'}
            </h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                <span className="text-slate-300 font-semibold">{language === 'si' ? 'ගිණුම' : 'Account'}</span>
                <span className="text-emerald-400 font-bold">{userData?.username}</span>
              </div>

              <div className="flex justify-between items-center p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                <span className="text-slate-300 font-semibold">{language === 'si' ? 'භාෂාව' : 'Language'}</span>
                <button 
                  onClick={() => setLanguage(l => l === 'si' ? 'en' : 'si')}
                  className="px-5 py-2 bg-slate-900 border border-slate-700 rounded-xl font-bold text-emerald-400 shadow-sm hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
                >
                  {language === 'si' ? 'සිංහල' : 'English'}
                </button>
              </div>
              
              <div className="flex justify-between items-center p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                <span className="text-slate-300 font-semibold">{language === 'si' ? 'කලාපය' : 'Timezone'}</span>
                <span className="text-slate-500 text-xs font-mono bg-slate-900 px-3 py-1 rounded-lg border border-slate-700">Asia/Colombo</span>
              </div>

              <div className="flex justify-between items-center p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                <span className="text-slate-300 font-semibold">{language === 'si' ? 'දැනුම්දීම්' : 'Notifications'}</span>
                <button 
                  onClick={() => Notification.requestPermission()}
                  className="px-5 py-2 bg-slate-900 border border-slate-700 rounded-xl font-bold text-emerald-400 shadow-sm hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
                >
                  {language === 'si' ? 'සක්‍රීය කරන්න' : 'Enable'}
                </button>
              </div>

              <div className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-emerald-400 font-bold text-sm">{language === 'si' ? 'ගිණුම් තත්ත්වය' : 'Subscription Status'}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    isSubscribed ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
                  )}>
                    {isSubscribed ? (language === 'si' ? 'සක්‍රීයයි' : 'Active') : (language === 'si' ? 'නොමිලේ' : 'Free Trial')}
                  </span>
                </div>
                {!isSubscribed && (
                  <p className="text-emerald-400/60 text-[10px] leading-relaxed">
                    {language === 'si' ? `ඔබේ නොමිලේ කාලය ${format(trialExpiryDate, 'yyyy-MM-dd')} දිනෙන් අවසන් වේ.` : `Your free trial expires on ${format(trialExpiryDate, 'yyyy-MM-dd')}.`}
                  </p>
                )}
              </div>

              <div className="pt-6 border-t border-slate-800 space-y-4">
                <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                    {language === 'si' ? 'දැනුම්දීම් පරීක්ෂාව' : 'Alarm Test'}
                  </h4>
                  <button 
                    onClick={() => {
                      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                      const playTone = (freq: number, start: number, duration: number) => {
                        const oscillator = audioCtx.createOscillator();
                        const gainNode = audioCtx.createGain();
                        oscillator.connect(gainNode);
                        gainNode.connect(audioCtx.destination);
                        oscillator.type = 'sine';
                        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
                        gainNode.gain.setValueAtTime(0, audioCtx.currentTime + start);
                        gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + start + 0.05);
                        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + start + duration);
                        oscillator.start(audioCtx.currentTime + start);
                        oscillator.stop(audioCtx.currentTime + start + duration);
                      };
                      playTone(880, 0, 0.3);
                      playTone(1100, 0.4, 0.5);
                      
                      if (Notification.permission !== 'granted') {
                        Notification.requestPermission();
                      } else {
                        new Notification(language === 'si' ? 'පරීක්ෂණ දැනුම්දීම' : 'Test Notification', {
                          body: language === 'si' ? 'ඔබේ දැනුම්දීම් නිවැරදිව ක්‍රියා කරයි!' : 'Your notifications are working correctly!',
                          icon: '/favicon.ico'
                        });
                      }
                    }}
                    className="w-full py-3 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Bell className="w-4 h-4 text-emerald-400" />
                    {language === 'si' ? 'ශබ්දය පරීක්ෂා කරන්න' : 'Test Alarm Sound'}
                  </button>
                </div>

                <button 
                  onClick={handleLogout}
                  className="w-full py-4 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl hover:bg-rose-500/20 transition-all active:scale-[0.98]"
                >
                  <Unlock className="w-4 h-4" />
                  {language === 'si' ? 'පිටවන්න' : 'Logout'}
                </button>
              </div>

                  <div className="pt-6 border-t border-slate-800">
                    <button 
                      onClick={() => {
                        const testReminder = { title: 'Test Alarm', date: format(new Date(), 'yyyy-MM-dd'), time: 'Test' } as Reminder;
                        setActiveAlarm(testReminder);
                        // Trigger sound
                        try {
                          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                          const osc = audioCtx.createOscillator();
                          osc.connect(audioCtx.destination);
                          osc.start();
                          osc.stop(audioCtx.currentTime + 0.5);
                        } catch(e) {}
                      }}
                      className="w-full py-3 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-all mb-4"
                    >
                      {language === 'si' ? 'ශබ්දය පරීක්ෂා කරන්න' : 'Test Alarm Sound'}
                    </button>
                    <p className="text-[10px] text-slate-300 text-center font-bold uppercase tracking-[0.2em] leading-relaxed">
                  Vaastu.lk Reminder v1.0.0<br/>
                  <span className="text-slate-400 font-medium">
                    {language === 'si' ? 'ඔබගේ එදිනෙදා කටයුතු පහසුවෙන් මතක් කරගන්න.' : 'Simplify your daily reminders.'}
                  </span>
                  <br/>
                  <span className="text-emerald-500/60 mt-2 block">
                    Developed By J. Godakanda Arachchi
                  </span>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      );
    }

    const filtered = reminders.filter(r => {
      if (activeTab === 'special') return r.is_special;
      
      const matchesSearch = r.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           r.type.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (searchQuery === 'today') return isToday(parseISO(r.date)) && matchesSearch;
      if (searchQuery === 'week') {
        const date = parseISO(r.date);
        return date >= startOfWeek(new Date()) && date <= endOfWeek(new Date()) && matchesSearch;
      }
      
      return matchesSearch;
    });

    if (filtered.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center py-20 px-10">
          <div className="w-24 h-24 bg-slate-900 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-sm border border-slate-800">
            <Mic className="w-10 h-10 text-emerald-400/40" />
          </div>
          <h3 className="text-white font-bold text-xl font-display">
            {language === 'si' ? 'කිසිවක් නැත' : 'No reminders found'}
          </h3>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed max-w-[240px] mx-auto">
            {language === 'si' ? 'මයික් එක ඔබා අලුත් දෙයක් එකතු කරන්න' : 'Tap the microphone button below to add your first reminder'}
          </p>
          <button 
            onClick={openManualAdd}
            className="mt-10 px-8 py-3.5 bg-emerald-500 text-white text-sm font-bold rounded-2xl flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
          >
            <Plus className="w-5 h-5" />
            {language === 'si' ? 'මැනුවල් එකතු කරන්න' : 'Add Manually'}
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {filtered.map((reminder) => {
          const Icon = IconMap[reminder.type] || CheckCircle2;
          return (
            <motion.div
              key={reminder.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "p-5 card-premium flex items-start gap-4 group relative",
                reminder.is_pinned && "border-emerald-200 bg-emerald-50/20"
              )}
            >
              <div className={cn(
                "p-3 rounded-2xl shrink-0 shadow-sm",
                reminder.type === 'payment' ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                reminder.type === 'birthday' ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" :
                reminder.type === 'special' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                reminder.type === 'appointment' ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" :
                "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              )}>
                <Icon className="w-5 h-5" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-white truncate pr-2">
                    {reminder.title}
                  </h3>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => togglePin(reminder.id!, !!reminder.is_pinned)}
                      className={cn("p-1 rounded-lg hover:bg-slate-800", reminder.is_pinned ? "text-emerald-400" : "text-slate-500")}
                    >
                      <Pin className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setEditingReminder(reminder)}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-500"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleShare(reminder)}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-500"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    {reminder.voice_data && (
                      <button 
                        onClick={() => playVoice(reminder.voice_data!)}
                        className="p-1 rounded-lg hover:bg-slate-800 text-emerald-400"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    )}
                    <button 
                      onClick={() => deleteReminder(reminder.id!)}
                      className="p-1 rounded-lg hover:bg-slate-800 text-rose-400/70 hover:text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 mt-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400/60" />
                    {isToday(parseISO(reminder.date)) ? (language === 'si' ? 'අද' : 'Today') : 
                     isTomorrow(parseISO(reminder.date)) ? (language === 'si' ? 'හෙට' : 'Tomorrow') : 
                     reminder.date}
                  </span>
                  {reminder.time && (
                    <span className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-indigo-400/60" />
                      {reminder.time}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    );
  };

  if (isTrialExpired) {
    return (
      <div className="max-w-md mx-auto h-full flex flex-col bg-slate-950 items-center justify-center p-10 text-center text-white">
        <div className="w-24 h-24 bg-amber-500/10 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-sm border border-amber-500/20">
          <Bell className="w-12 h-12 text-amber-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-4 font-display">
          {language === 'si' ? 'නොමිලේ කාලය අවසන්' : 'Trial Expired'}
        </h1>
        <p className="text-slate-400 mb-8 leading-relaxed">
          {language === 'si' 
            ? 'ඔබේ මාස 3ක නොමිලේ කාලය අවසන් වී ඇත. දිගටම භාවිතා කිරීමට වාර්ෂික ගාස්තුව ගෙවන්න.' 
            : 'Your 3-month free trial has ended. Please pay the annual fee to continue using the app.'}
        </p>
        
        <div className="w-full bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-800 mb-8">
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-3">Annual Subscription</p>
          <p className="text-4xl font-black text-white mb-2">Rs. 500.00</p>
          <p className="text-emerald-400/60 text-xs font-medium">{language === 'si' ? 'වසරකට වරක් පමණි' : 'Per Year'}</p>
        </div>

        <button 
          onClick={handlePayment}
          className="w-full py-5 bg-emerald-500 text-white rounded-[1.5rem] font-bold text-lg shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-[0.98]"
        >
          {language === 'si' ? 'දැන් ගෙවන්න' : 'Pay Now'}
        </button>
        
        <button 
          onClick={() => setLanguage(l => l === 'si' ? 'en' : 'si')}
          className="mt-8 text-slate-500 text-xs font-bold uppercase tracking-widest hover:text-slate-300 transition-colors"
        >
          {language === 'si' ? 'Switch to English' : 'සිංහලට මාරු වන්න'}
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto h-full flex flex-col bg-slate-950 items-center justify-center p-8 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-slate-900/50 p-8 rounded-[2.5rem] border border-slate-800 backdrop-blur-xl shadow-2xl"
        >
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
              <Lock className="w-10 h-10 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2 font-display">Vaastu.lk</h1>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">
              {authMode === 'login' ? (language === 'si' ? 'ඇතුල් වන්න' : 'Login') : (language === 'si' ? 'ලියාපදිංචි වන්න' : 'Register')}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2 ml-1">
                {language === 'si' ? 'විද්‍යුත් තැපෑල' : 'Email'}
              </label>
              <input 
                type="email"
                required
                className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-white"
                value={authForm.email}
                onChange={e => setAuthForm({...authForm, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2 ml-1">
                {language === 'si' ? 'මුරපදය' : 'Password'}
              </label>
              <input 
                type="password"
                required
                className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-white"
                value={authForm.password}
                onChange={e => setAuthForm({...authForm, password: e.target.value})}
              />
            </div>
            <button 
              type="submit"
              className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95 mt-4"
            >
              {authMode === 'login' ? (language === 'si' ? 'ඇතුල් වන්න' : 'Login') : (language === 'si' ? 'ලියාපදිංචි වන්න' : 'Register')}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button 
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-emerald-400 text-sm font-bold hover:underline"
            >
              {authMode === 'login' 
                ? (language === 'si' ? 'ගිණුමක් නැද්ද? ලියාපදිංචි වන්න' : "Don't have an account? Register") 
                : (language === 'si' ? 'ගිණුමක් තිබේද? ඇතුල් වන්න' : 'Already have an account? Login')}
            </button>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-800/50 text-center">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">
              Developed By J. Godakanda Arachchi
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto h-full flex flex-col bg-slate-950 relative overflow-hidden shadow-2xl font-sans text-slate-200">
      {/* Header */}
      <header className="p-6 pb-4 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 shrink-0 sticky top-0 z-40">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white font-display tracking-tight">
              {activeTab === 'home' && (language === 'si' ? 'මතක් කිරීම්' : 'Reminders')}
              {activeTab === 'special' && (language === 'si' ? 'විශේෂ සිදුවීම්' : 'Special Events')}
              {activeTab === 'calendar' && (language === 'si' ? 'දින දර්ශනය' : 'Calendar')}
              {activeTab === 'settings' && (language === 'si' ? 'සැකසුම්' : 'Settings')}
              {activeTab === 'vaastu' && (language === 'si' ? 'සේවා' : 'Services')}
            </h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em] mt-1">
              {format(new Date(), 'EEEE, MMMM do')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab !== 'settings' && (
              <button 
                onClick={openManualAdd}
                className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                title={language === 'si' ? 'මැනුවල් එකතු කරන්න' : 'Add Manually'}
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            <button 
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-all border border-slate-800"
              title={language === 'si' ? 'පිටවන්න' : 'Logout'}
            >
              <Unlock className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setLanguage(l => l === 'si' ? 'en' : 'si')}
              className="px-4 py-2 rounded-xl bg-emerald-500/10 text-[10px] font-bold text-emerald-400 uppercase tracking-widest hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
            >
              {language === 'si' ? 'English' : 'සිංහල'}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {activeTab !== 'settings' && (
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-400 transition-colors" />
            <input 
              type="text"
              placeholder={language === 'si' ? 'සොයන්න...' : 'Search...'}
              className="w-full pl-11 pr-10 py-3 bg-slate-900/80 border border-slate-800 rounded-2xl text-sm text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all outline-none placeholder:text-slate-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Content Area */}
      <main className="flex-1 p-6 overflow-y-auto pb-32">
        <AnimatePresence mode="popLayout">
          {renderContent()}
        </AnimatePresence>
      </main>

      {/* Alarm Popup */}
      <AnimatePresence>
        {activeAlarm && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md"
          >
            <div className="w-full max-w-sm bg-slate-900 border border-emerald-500/30 rounded-[2.5rem] p-8 text-center shadow-2xl shadow-emerald-500/20">
              <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <Bell className="w-10 h-10 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 font-display">
                {language === 'si' ? 'මතක් කිරීමක්!' : 'Reminder Alert!'}
              </h2>
              <p className="text-slate-300 text-lg mb-8">
                {activeAlarm.title}
              </p>
              <button 
                onClick={() => setActiveAlarm(null)}
                className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95"
              >
                {language === 'si' ? 'හරි' : 'Dismiss'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Overlay */}
      <AnimatePresence>
        {isListening && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-10 text-white"
          >
            <div className="relative mb-12">
              <div className="absolute inset-[-20px] bg-emerald-500/20 rounded-full mic-pulse" />
              <div className="relative bg-slate-900 p-10 rounded-full shadow-2xl border border-emerald-500/30">
                <Mic className="w-14 h-14 text-emerald-400" />
              </div>
            </div>
            
            <h2 className="text-2xl font-bold mb-4 font-display">
              {language === 'si' ? 'මම අහගෙන ඉන්නේ...' : 'Listening...'}
            </h2>
            
            <div className="bg-slate-900/50 p-8 rounded-3xl w-full max-w-xs text-center min-h-[120px] flex items-center justify-center border border-white/10 backdrop-blur-sm">
              <p className="text-xl italic font-medium opacity-90 text-emerald-100">
                {transcript || (language === 'si' ? '"හෙට උදේ 9ට බිල් ගෙවන්න මතක් කරන්න"' : '"Remind me to pay bills tomorrow at 9am"')}
              </p>
            </div>

            <button 
              onClick={stopListening}
              className="mt-12 px-10 py-4 bg-emerald-500 text-white rounded-full font-bold shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95"
            >
              {language === 'si' ? 'නැවැත්වීමට ඔබන්න' : 'Tap to Stop'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Parsing Overlay */}
      {isParsing && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
          <div className="w-14 h-14 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4 shadow-lg shadow-emerald-500/20" />
          <p className="text-emerald-400 font-bold text-lg font-display">
            {language === 'si' ? 'සකසමින් පවතී...' : 'Processing...'}
          </p>
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {editingReminder && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          >
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-slate-900 w-full max-w-md rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl border-t border-slate-800"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-white font-display">
                  {language === 'si' ? 'මතක් කිරීම' : 'Reminder'}
                </h2>
                <button onClick={() => setEditingReminder(null)} className="p-2.5 hover:bg-slate-800 rounded-full transition-colors">
                  <X className="w-6 h-6 text-slate-500" />
                </button>
              </div>

              <form onSubmit={saveReminder} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                    {language === 'si' ? 'මාතෘකාව' : 'Title'}
                  </label>
                  <input 
                    type="text"
                    required
                    autoFocus
                    className="w-full p-5 bg-slate-950 border border-slate-800 rounded-[1.5rem] focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-lg font-semibold text-white outline-none transition-all"
                    value={editingReminder.title}
                    onChange={e => setEditingReminder({...editingReminder, title: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                      {language === 'si' ? 'දිනය' : 'Date'}
                    </label>
                    <input 
                      type="date"
                      required
                      className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-slate-300 font-medium"
                      value={editingReminder.date}
                      onChange={e => setEditingReminder({...editingReminder, date: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                      {language === 'si' ? 'වේලාව' : 'Time'}
                    </label>
                    <input 
                      type="time"
                      className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-slate-300 font-medium"
                      value={editingReminder.time}
                      onChange={e => setEditingReminder({...editingReminder, time: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                      {language === 'si' ? 'වර්ගය' : 'Type'}
                    </label>
                    <div className="relative">
                      <select 
                        className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none outline-none transition-all text-slate-300 font-medium"
                        value={editingReminder.type}
                        onChange={e => setEditingReminder({...editingReminder, type: e.target.value as any})}
                      >
                        <option value="task">Task</option>
                        <option value="payment">Payment</option>
                        <option value="birthday">Birthday</option>
                        <option value="appointment">Appointment</option>
                        <option value="special">Special</option>
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                        <Plus className="w-4 h-4 rotate-45" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                      WhatsApp
                    </label>
                    <input 
                      type="text"
                      placeholder="077..."
                      className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-slate-300 font-medium"
                      value={editingReminder.share_to}
                      onChange={e => setEditingReminder({...editingReminder, share_to: e.target.value})}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="relative flex items-center">
                    <input 
                      type="checkbox"
                      id="is_special"
                      className="w-6 h-6 rounded-lg text-emerald-500 focus:ring-emerald-500/20 border-slate-700 bg-slate-900 transition-all cursor-pointer"
                      checked={editingReminder.is_special}
                      onChange={e => setEditingReminder({...editingReminder, is_special: e.target.checked})}
                    />
                  </div>
                  <label htmlFor="is_special" className="text-sm font-bold text-slate-400 cursor-pointer select-none">
                    {language === 'si' ? 'විශේෂ සිදුවීමක් ලෙස සලකුණු කරන්න' : 'Mark as Special Event'}
                  </label>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">
                    {language === 'si' ? 'හඬ පටිගත කිරීම' : 'Voice Note'}
                  </label>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onTouchStart={startRecording}
                      onTouchEnd={stopRecording}
                      className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                        isRecording ? "bg-rose-500 animate-pulse" : "bg-slate-800 text-emerald-400 hover:bg-slate-700"
                      )}
                    >
                      <Mic className="w-5 h-5" />
                    </button>
                    <div className="flex-1">
                      {isRecording ? (
                        <p className="text-rose-400 text-xs font-bold animate-pulse">Recording...</p>
                      ) : editingReminder.voice_data ? (
                        <div className="flex items-center gap-2">
                          <p className="text-emerald-400 text-xs font-bold">Voice note added</p>
                          <button 
                            type="button"
                            onClick={() => playVoice(editingReminder.voice_data!)}
                            className="text-[10px] text-slate-500 underline uppercase tracking-wider"
                          >
                            Play
                          </button>
                          <button 
                            type="button"
                            onClick={() => setEditingReminder({...editingReminder, voice_data: undefined})}
                            className="text-[10px] text-rose-500 underline uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-xs">Hold to record a voice note</p>
                      )}
                    </div>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-5 bg-emerald-500 text-white rounded-[1.5rem] font-bold text-lg shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                >
                  <Plus className="w-6 h-6" />
                  {language === 'si' ? 'සුරකින්න' : 'Save Reminder'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 px-6 py-4 pb-8 flex justify-between items-center z-50 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.3)]">
        <button 
          onClick={() => setActiveTab('home')}
          className={cn("p-3 rounded-2xl transition-all duration-300", activeTab === 'home' ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800")}
        >
          <CheckCircle2 className="w-6 h-6" />
        </button>
        <button 
          onClick={() => setActiveTab('vaastu')}
          className={cn("p-3 rounded-2xl transition-all duration-300", activeTab === 'vaastu' ? "text-amber-400 bg-amber-500/10" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800")}
        >
          <DraftingCompass className="w-6 h-6" />
        </button>
        
        {/* Main Mic Button */}
        <div className="relative -top-10">
          <button 
            onClick={startListening}
            className="w-16 h-16 bg-emerald-500 rounded-full shadow-[0_10px_25px_-5px_rgba(16,185,129,0.5)] flex items-center justify-center text-white hover:bg-emerald-600 transition-all active:scale-90 border-[4px] border-slate-900"
          >
            <Mic className="w-7 h-7" />
          </button>
        </div>

        <button 
          onClick={() => setActiveTab('calendar')}
          className={cn("p-3 rounded-2xl transition-all duration-300", activeTab === 'calendar' ? "text-sky-400 bg-sky-500/10" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800")}
        >
          <Calendar className="w-6 h-6" />
        </button>
        <button 
          onClick={() => setActiveTab('settings')}
          className={cn("p-3 rounded-2xl transition-all duration-300", activeTab === 'settings' ? "text-slate-200 bg-slate-800" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800")}
        >
          <SettingsIcon className="w-6 h-6" />
        </button>
      </nav>
    </div>
  );
}

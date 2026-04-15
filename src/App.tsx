import React, { useEffect, useState, useMemo } from 'react';
import { 
  collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, doc, setDoc, getDoc, updateDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { GoogleGenAI } from "@google/genai";
import { 
  Calendar, Heart, History, Plus, LogOut, Sparkles, Activity, Thermometer, 
  Droplets, TestTube, ChevronRight, ChevronLeft, Settings, BarChart3, Info,
  MessageSquare, Send, X, Bot, Smile, Zap, Scale, ShieldCheck, BookOpen, Bell, Download, Lock, CircleDot, Smartphone
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { motion, AnimatePresence } from 'motion/react';
import { format, differenceInDays, parseISO, startOfDay, addDays, subDays, isSameDay, isWithinInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { 
  calculateAverageCycle, calculateAveragePeriodDuration, getPredictions, calculateRisk, getCyclePhase, CycleEntry, DailyLog, DEFAULT_CYCLE_LENGTH
} from './lib/cycleLogic';
import { cn } from './lib/utils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<CycleEntry[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [avgCycle, setAvgCycle] = useState(DEFAULT_CYCLE_LENGTH);
  const [avgPeriod, setAvgPeriod] = useState(5);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isLogging, setIsLogging] = useState(false);
  const [activeTab, setActiveTab] = useState<'cycle' | 'calendar' | 'analysis' | 'plus'>('cycle');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isPregnancyMode, setIsPregnancyMode] = useState(false);
  const [contraceptionType, setContraceptionType] = useState('Aucune');
  const [savedPin, setSavedPin] = useState<string | null>(null);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPartnerSharing, setShowPartnerSharing] = useState(false);
  const [showCycleSettings, setShowCycleSettings] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [notifications, setNotifications] = useState({
    period: true,
    ovulation: true,
    contraception: false
  });

  // Auth & Data Listeners
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch user settings (PIN, etc.)
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setSavedPin(data.pin || null);
          if (data.pin) setIsAppLocked(true);
          setNotifications(data.notifications || { period: true, ovulation: true, contraception: false });
          setIsPregnancyMode(data.pregnancyMode || false);
          setContraceptionType(data.contraceptionType || 'Aucune');
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const cyclesQuery = query(collection(db, 'cycles'), where('uid', '==', user.uid), orderBy('startDate', 'desc'));
    const logsQuery = query(collection(db, 'logs'), where('uid', '==', user.uid), orderBy('date', 'desc'));

    const unsubCycles = onSnapshot(cyclesQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as CycleEntry));
      setCycles(data);
      setAvgCycle(calculateAverageCycle(data));
    });

    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyLog));
      setLogs(data);
      setAvgPeriod(calculateAveragePeriodDuration(data));
    });

    return () => { unsubCycles(); unsubLogs(); };
  }, [user]);

  const predictions = useMemo(() => {
    if (cycles.length === 0) return null;
    return getPredictions(cycles[0].startDate, avgCycle);
  }, [cycles, avgCycle]);

  const currentLog = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    return logs.find(l => l.date === dateStr);
  }, [logs, selectedDate]);

  const cycleDay = useMemo(() => {
    if (cycles.length === 0) return null;
    const lastStart = parseISO(cycles[0].startDate);
    const diff = differenceInDays(new Date(), lastStart);
    return (diff % avgCycle) + 1;
  }, [cycles, avgCycle]);

  const chartData = useMemo(() => {
    const last14Logs = [...logs]
      .filter(l => l.temperature)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
    
    return {
      labels: last14Logs.map(l => format(parseISO(l.date), 'dd/MM')),
      datasets: [{
        label: 'Température (°C)',
        data: last14Logs.map(l => l.temperature || null),
        borderColor: '#3D7AB0',
        backgroundColor: 'rgba(61, 122, 176, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: '#3D7AB0',
      }]
    };
  }, [logs]);

  const handleUpdateLog = async (field: string, value: any) => {
    if (!user) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const logRef = currentLog ? doc(db, 'logs', currentLog.id) : null;

    const data = {
      uid: user.uid,
      date: dateStr,
      [field]: value,
      updatedAt: serverTimestamp()
    };

    try {
      if (logRef) {
        await updateDoc(logRef, data);
      } else {
        await addDoc(collection(db, 'logs'), { ...data, createdAt: serverTimestamp() });
      }
    } catch (err) { console.error(err); }
  };

  const handleAddCycle = async () => {
    if (!user) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    try {
      await addDoc(collection(db, 'cycles'), {
        uid: user.uid,
        startDate: dateStr,
        createdAt: serverTimestamp()
      });
    } catch (err) { console.error(err); }
  };

  const handleAiChat = async () => {
    if (!chatInput.trim() || isAiLoading) return;
    
    const userMsg = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setIsAiLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const recentSymptoms = logs
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5)
        .map(l => `${l.date}: ${l.symptoms?.join(', ') || 'Aucun symptôme'}, Flux: ${l.flow || 'N/A'}, Humeur: ${l.mood || 'N/A'}`)
        .join('\n');

      const systemPrompt = `
        Tu es "Fox", une intelligence artificielle experte en santé féminine, comparable à une version spécialisée de ChatGPT. 
        Ton ton est empathique, professionnel, rassurant et hautement informatif.

        CONTEXTE DE L'UTILISATRICE :
        - Jour du cycle : ${cycleDay || 'Inconnu'}
        - Durée moyenne du cycle : ${avgCycle} jours
        - Durée moyenne des règles : ${avgPeriod} jours
        - Phase actuelle : ${predictions ? getCyclePhase(new Date(), cycles[0].startDate, predictions[0]) : 'Inconnue'}
        - Risque de conception : ${predictions ? calculateRisk(new Date(), predictions) : 'Inconnu'}
        - Mode Grossesse : ${isPregnancyMode ? 'Activé' : 'Désactivé'}
        - Contraception : ${contraceptionType}
        
        HISTORIQUE RÉCENT :
        ${recentSymptoms}

        DIRECTIVES CRITIQUES :
        1. SANTÉ FÉMININE : Réponds à TOUTES les questions liées à la santé des femmes (menstruations, fertilité, ménopause, sexualité, pathologies comme l'endométriose ou le SOPK, etc.).
        2. DÉTECTION & PRÉVENTION : Si l'utilisatrice décrit des symptômes, analyse-les pour suggérer des causes potentielles (ex: infection, déséquilibre hormonal, endométriose) tout en précisant qu'il s'agit de pistes et non d'un diagnostic.
        3. CONSEIL MÉDICAL : Si les symptômes semblent graves (douleur intense, saignements anormaux, fièvre, etc.) ou si le cas dépasse tes capacités, conseille SYSTÉMATIQUEMENT et FERMEMENT de consulter un médecin ou un gynécologue.
        4. DOULEURS MENSTRUELLES : Si l'utilisatrice souffre, propose des solutions concrètes : chaleur (bouillotte), positions de yoga, hydratation, alimentation (magnésium, oméga-3), et suggère des anti-inflammatoires si approprié (en rappelant de vérifier les contre-indications).
        5. STYLE : Utilise un langage clair, scientifique mais accessible. Structure tes réponses avec des puces si nécessaire pour la clarté.

        RAPPEL : Tu es un assistant d'aide, pas un remplaçant pour un professionnel de santé.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMsg,
        config: {
          systemInstruction: systemPrompt
        }
      });

      const aiText = response.text || "Désolé, je n'ai pas pu générer de réponse.";
      setChatMessages(prev => [...prev, { role: 'ai', text: aiText }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'ai', text: "Une erreur est survenue lors de la connexion à l'IA." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.setTextColor(0, 43, 82); // App Navy
    doc.text('Rapport imma cycle care', 14, 22);
    
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Généré le : ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30);
    doc.text(`Utilisateur : ${user?.displayName || user?.email}`, 14, 36);

    doc.setFontSize(14);
    doc.setTextColor(212, 175, 55); // App Gold
    doc.text('Statistiques Globales', 14, 50);
    
    const statsData = [
      ['Cycle Moyen', `${avgCycle} jours`],
      ['Durée des Règles Moyenne', `${avgPeriod} jours`],
      ['Nombre de Cycles Suivis', `${cycles.length}`],
      ['Mode Grossesse', isPregnancyMode ? 'Activé' : 'Désactivé'],
      ['Contraception', contraceptionType]
    ];

    (doc as any).autoTable({
      startY: 55,
      head: [['Métrique', 'Valeur']],
      body: statsData,
      theme: 'striped',
      headStyles: { fillColor: [0, 43, 82] }
    });

    doc.text('Historique des 30 derniers jours', 14, (doc as any).lastAutoTable.finalY + 15);
    
    const recentLogs = [...logs]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map(l => [
        l.date,
        l.flow || '-',
        l.mood || '-',
        l.temperature ? `${l.temperature}°C` : '-',
        l.symptoms?.join(', ') || '-'
      ]);

    (doc as any).autoTable({
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Date', 'Flux', 'Humeur', 'Temp.', 'Symptômes']],
      body: recentLogs,
      theme: 'grid',
      headStyles: { fillColor: [0, 43, 82] }
    });

    doc.save(`imma-rapport-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const handleSaveSettings = async (updates: any) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), updates, { merge: true });
    } catch (err) { console.error(err); }
  };

  const handlePinSubmit = () => {
    if (pinInput === savedPin) {
      setIsAppLocked(false);
      setPinInput('');
    } else {
      setPinInput('');
      // Simple shake effect could be added here
    }
  };

  const handleSetPin = async (newPin: string) => {
    if (!user) return;
    setSavedPin(newPin);
    await handleSaveSettings({ pin: newPin });
    setShowPinSetup(false);
  };

  if (loading) return <div className="min-h-screen bg-app-navy flex items-center justify-center"><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-app-gold"><Activity size={40} /></motion.div></div>;

  if (!user) return (
    <div className="min-h-screen bg-app-navy flex flex-col items-center justify-center p-6 text-center space-y-8">
      <div className="space-y-4">
        <div className="w-24 h-24 bg-app-fox/10 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-app-fox/10">
          <svg viewBox="0 0 24 24" fill="none" className="w-16 h-16">
            <path d="M12 2L4.5 9V15L12 22L19.5 15V9L12 2Z" fill="#F38B4B" />
            <path d="M12 2L8 6L12 10L16 6L12 2Z" fill="#FFFFFF" opacity="0.5" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tighter text-app-gold-dark">Fox</h1>
          <p className="text-app-gray font-medium">Suivi de cycle intelligent et élégant.</p>
        </div>
      </div>
      <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-app-gold text-white px-10 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-app-gold/20 active:scale-95 transition-all">
        Se connecter avec Google
      </button>
    </div>
  );

  if (isAppLocked) return (
    <div className="min-h-screen bg-app-navy flex flex-col items-center justify-center p-6 text-center space-y-12">
      <div className="space-y-4">
        <div className="w-20 h-20 bg-app-gold/10 rounded-3xl flex items-center justify-center text-app-gold mx-auto">
          <Lock size={40} />
        </div>
        <h2 className="text-2xl font-bold text-app-gold-dark">Application Verrouillée</h2>
        <p className="text-app-gray text-sm">Entrez votre code PIN pour accéder à vos données.</p>
      </div>

      <div className="flex gap-4">
        {[1, 2, 3, 4].map((_, i) => (
          <div key={i} className={cn("w-4 h-4 rounded-full border-2 border-app-gold transition-all", pinInput.length > i ? "bg-app-gold" : "bg-transparent")} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map((num) => (
          <button 
            key={num}
            onClick={() => {
              if (num === 'C') setPinInput('');
              else if (num === 'OK') handlePinSubmit();
              else if (pinInput.length < 4) setPinInput(prev => prev + num);
            }}
            className="w-16 h-16 rounded-full bg-slate-200/50 flex items-center justify-center text-xl font-bold text-app-gold-dark active:bg-app-gold active:text-white transition-all"
          >
            {num}
          </button>
        ))}
      </div>
      
      <button onClick={() => signOut(auth)} className="text-app-gray text-xs underline">Se déconnecter</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-app-navy pb-24 max-w-md mx-auto relative overflow-x-hidden">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-30 border-b border-app-gold/5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-app-fox/10 rounded-2xl flex items-center justify-center shadow-lg shadow-app-fox/10">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
              <path d="M12 2L4.5 9V15L12 22L19.5 15V9L12 2Z" fill="#F38B4B" />
              <path d="M12 2L8 6L12 10L16 6L12 2Z" fill="#FFFFFF" opacity="0.5" />
              <circle cx="9" cy="12" r="1" fill="#000000" />
              <circle cx="15" cy="12" r="1" fill="#000000" />
              <path d="M11 14C11 14 12 15 13 14" stroke="#000000" strokeWidth="0.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-app-gold-dark">Fox</h1>
            <p className="text-[10px] text-app-gold font-bold uppercase tracking-widest">Cycle Care</p>
          </div>
        </div>
        <div className="flex gap-4">
          <button onClick={() => signOut(auth)} className="text-app-gray hover:text-app-fox transition-colors"><LogOut size={22} /></button>
        </div>
      </header>

      <main className="px-6 space-y-8">
        {activeTab === 'cycle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            {/* Circular Dashboard */}
            <section className="flex flex-col items-center justify-center py-8">
              <div className="relative w-72 h-72 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                  <circle cx="144" cy="144" r="125" fill="none" stroke="var(--color-app-dark-gray)" strokeWidth="16" />
                  {!isPregnancyMode && (
                    <circle 
                      cx="144" cy="144" r="125" fill="none" stroke="var(--color-app-gold)" strokeWidth="16" 
                      strokeDasharray={2 * Math.PI * 125}
                      strokeDashoffset={2 * Math.PI * 125 * (1 - (cycleDay || 0) / avgCycle)}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                  )}
                </svg>
                <div className="text-center space-y-1 z-10">
                  {isPregnancyMode ? (
                    <>
                      <p className="text-app-gray text-xs font-bold uppercase tracking-widest">Mode Grossesse</p>
                      <p className="text-5xl font-bold text-app-gold">Félicitations !</p>
                      <p className="text-[10px] text-app-gray mt-2">Suivi de cycle suspendu</p>
                    </>
                  ) : (
                    <>
                      <p className="text-app-gray text-xs font-bold uppercase tracking-widest">Jour du cycle</p>
                      <p className="text-8xl font-bold">{cycleDay || '--'}</p>
                      <p className="font-bold text-sm uppercase tracking-wider text-app-gold">
                        {predictions ? getCyclePhase(new Date(), cycles[0].startDate, predictions[0]) : 'Prêt'}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-8 flex gap-12 text-center">
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-black">{avgCycle}j</p>
                  <p className="text-[10px] text-black uppercase font-black tracking-tighter">Cycle Moyen</p>
                </div>
                <div className="w-px h-10 bg-app-gold/20" />
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-app-gold">{avgPeriod}j</p>
                  <p className="text-[10px] text-black uppercase font-black tracking-tighter">Durée Règles</p>
                </div>
              </div>
            </section>

            {/* Daily Log Quick Access */}
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">Aujourd'hui</h3>
                <button onClick={() => setIsLogging(true)} className="bg-app-gold/10 text-app-gold px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1 active:scale-95 transition-all">
                  <Plus size={16} /> Ajouter des données
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className={cn("clue-pill", currentLog?.flow && currentLog.flow !== 'Aucun' ? "clue-pill-active-red" : "clue-pill-inactive")}>
                  <Droplets size={24} />
                  <span className="text-[10px] mt-1 font-bold">Flux</span>
                </div>
                <div className={cn("clue-pill", currentLog?.sex && currentLog.sex !== 'Aucun' ? "clue-pill-active-blue" : "clue-pill-inactive")}>
                  <Heart size={24} />
                  <span className="text-[10px] mt-1 font-bold">Sexe</span>
                </div>
                <div className={cn("clue-pill", currentLog?.temperature ? "clue-pill-active-blue" : "clue-pill-inactive")}>
                  <Thermometer size={24} />
                  <span className="text-[10px] mt-1 font-bold">Temp.</span>
                </div>
                <div className={cn("clue-pill", currentLog?.lh_test && currentLog.lh_test !== 'Non fait' ? "clue-pill-active-blue" : "clue-pill-inactive")}>
                  <TestTube size={24} />
                  <span className="text-[10px] mt-1 font-bold">Test</span>
                </div>
              </div>
            </section>

            {/* Risk Analysis Card */}
            {predictions && !isPregnancyMode && (
              <section className="clue-card bg-gradient-to-r from-app-gold/10 to-transparent border-l-4 border-app-gold">
                <div className="flex gap-4 items-start">
                  <div className="p-2 bg-app-gold/20 rounded-xl text-app-gold"><Info size={20} /></div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-sm">Analyse de Risque</h4>
                    <p className="text-xs font-bold text-app-gray leading-relaxed">
                      Risque de conception : <span className="text-app-gold font-bold uppercase">{calculateRisk(new Date(), predictions)}</span>.
                    </p>
                    <p className="text-[10px] text-app-gray font-bold italic">Ceci n'est pas une méthode contraceptive.</p>
                  </div>
                </div>
              </section>
            )}
          </motion.div>
        )}

        {activeTab === 'calendar' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">Calendrier</h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCurrentMonth(subDays(startOfMonth(currentMonth), 1))}
                  className="p-2 bg-app-navy-light rounded-full text-app-gold active:scale-90 transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
                <button 
                  onClick={() => setCurrentMonth(addDays(endOfMonth(currentMonth), 1))}
                  className="p-2 bg-app-navy-light rounded-full text-app-gold active:scale-90 transition-all"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>

            <div className="clue-card space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-bold capitalize">{format(currentMonth, 'MMMM yyyy', { locale: fr })}</h3>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-black uppercase tracking-widest mb-2">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {(() => {
                  const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
                  const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
                  const days = [];
                  let curr = start;
                  while (curr <= end) {
                    days.push(curr);
                    curr = addDays(curr, 1);
                  }
                  return days.map((date, i) => {
                    const isToday = isSameDay(date, new Date());
                    const isCurrentMonth = format(date, 'MM') === format(currentMonth, 'MM');
                    const log = logs.find(l => l.date === format(date, 'yyyy-MM-dd'));
                    const isPeriod = log?.flow && log.flow !== 'Aucun';
                    const isFertile = !isPregnancyMode && predictions?.some(p => isWithinInterval(date, { start: p.fertilityStart, end: p.fertilityEnd }));
                    const isOvulation = !isPregnancyMode && predictions?.some(p => isSameDay(date, p.ovulationDate));
                    const risk = predictions ? calculateRisk(date, predictions) : 'Faible';
                    
                    return (
                      <motion.div 
                        key={i} 
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.005 }}
                        onClick={() => { setSelectedDate(date); setIsLogging(true); }}
                        className={cn(
                          "aspect-square flex flex-col items-center justify-center rounded-xl relative transition-all active:scale-90 cursor-pointer overflow-hidden",
                          isToday ? "ring-2 ring-white z-10" : "",
                          !isCurrentMonth && "opacity-20",
                          isCurrentMonth && !isPeriod && !isFertile && "bg-white/5",
                          isPeriod && "bg-red-500/20 text-red-200",
                          isFertile && !isPeriod && (risk === 'Élevé' ? "bg-app-gold/20 text-app-gold" : "bg-blue-500/10 text-blue-200")
                        )}
                      >
                        {isFertile && risk === 'Élevé' && (
                          <motion.div 
                            animate={{ opacity: [0.1, 0.3, 0.1] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="absolute inset-0 bg-app-gold/10"
                          />
                        )}
                        <span className={cn("text-xs font-bold relative z-10", isToday && "text-white")}>{format(date, 'd')}</span>
                        
                        <div className="absolute top-1 right-1 flex flex-col gap-0.5">
                          {isPeriod && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Droplets size={10} className="text-red-500 fill-red-500" /></motion.div>}
                        </div>

                        <div className="absolute bottom-1 flex gap-1">
                          {isOvulation && (
                            <motion.div 
                              initial={{ scale: 0, rotate: -45 }} 
                              animate={{ scale: 1, rotate: 0 }}
                              className="text-app-gold"
                            >
                              <CircleDot size={14} />
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    );
                  });
                })()}
              </div>
            </div>
            
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-app-gray uppercase tracking-widest">Légende</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <div className="w-4 h-4 bg-red-500/20 rounded-md flex items-center justify-center"><Droplets size={10} className="text-red-500 fill-red-500" /></div>
                  Règles
                </div>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <div className="w-4 h-4 bg-app-gold/20 rounded-md flex items-center justify-center"><CircleDot size={10} className="text-app-gold" /></div>
                  Ovulation
                </div>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <div className="w-4 h-4 bg-app-gold/20 rounded-md" />
                  Risque Élevé
                </div>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <div className="w-4 h-4 bg-blue-500/10 rounded-md" />
                  Risque Faible
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'analysis' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">Analyse</h2>
              <button 
                onClick={handleExportPDF}
                className="p-2 bg-app-gold/10 text-app-gold rounded-xl flex items-center gap-2 text-xs font-bold active:scale-95 transition-all"
              >
                <Download size={16} /> PDF
              </button>
            </div>
            <section className="clue-card space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold flex items-center gap-2"><BarChart3 size={16} /> Température Basale</h3>
                <span className="text-[10px] text-app-gray uppercase font-bold">14 derniers logs</span>
              </div>
              <div className="h-56">
                <Line 
                  data={chartData} 
                  options={{ 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { 
                      y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#64748B', font: { size: 10 } } },
                      x: { grid: { display: false }, ticks: { color: '#64748B', font: { size: 10 } } }
                    }
                  }} 
                />
              </div>
            </section>

            <div className="grid grid-cols-2 gap-4">
              <div className="clue-card space-y-2">
                <p className="text-3xl font-bold">{avgCycle}j</p>
                <p className="text-[10px] text-app-gray uppercase font-black">Cycle Moyen</p>
              </div>
              <div className="clue-card space-y-2">
                <p className="text-3xl font-bold">{cycles.length}</p>
                <p className="text-[10px] text-app-gray uppercase font-black">Cycles Suivis</p>
              </div>
            </div>

            <section className="clue-card space-y-4">
              <h3 className="text-sm font-bold flex items-center gap-2"><Smile size={16} /> Aperçu des Humeurs</h3>
              <div className="space-y-3">
                {['Heureuse', 'Calme', 'Irritable', 'Triste'].map(mood => {
                  const count = logs.filter(l => l.mood === mood).length;
                  const percentage = logs.length > 0 ? (count / logs.length) * 100 : 0;
                  return (
                    <div key={mood} className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold uppercase">
                        <span>{mood}</span>
                        <span>{count} fois</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }} animate={{ width: `${percentage}%` }}
                          className="h-full bg-app-gold"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </motion.div>
        )}

        {activeTab === 'plus' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <h2 className="text-2xl font-bold">Plus</h2>
            <div className="space-y-2">
              <div className="clue-card flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><Heart size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Mode Grossesse</p>
                    <p className="text-xs text-black font-bold">Suspendre les prédictions</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const next = !isPregnancyMode;
                    setIsPregnancyMode(next);
                    handleSaveSettings({ pregnancyMode: next });
                  }}
                  className={cn("w-12 h-6 rounded-full transition-all relative", isPregnancyMode ? "bg-app-gold" : "bg-white/10")}
                >
                  <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", isPregnancyMode ? "left-7" : "left-1")} />
                </button>
              </div>

              <button onClick={() => setShowCycleSettings(true)} className="w-full clue-card flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><Settings size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Paramètres du cycle</p>
                    <p className="text-xs text-black font-bold">Ajuster la durée du cycle et des règles</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <button onClick={() => setShowLearn(true)} className="w-full clue-card flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><BookOpen size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Apprendre</p>
                    <p className="text-xs text-black font-bold">Articles et conseils santé</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <button onClick={() => setShowNotifications(true)} className="w-full clue-card flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><Bell size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Notifications</p>
                    <p className="text-xs text-black font-bold">Rappels et alertes cycle</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <button onClick={() => setShowPinSetup(true)} className="w-full clue-card flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><Lock size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Sécurité PIN</p>
                    <p className="text-xs text-black font-bold">{savedPin ? 'Code PIN activé' : 'Protéger vos données'}</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <button onClick={() => setShowPartnerSharing(true)} className="w-full clue-card flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><MessageSquare size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Partage Partenaire</p>
                    <p className="text-xs text-black font-bold">Connecter un proche</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <div className="clue-card space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><ShieldCheck size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold">Contraception</p>
                    <select 
                      value={contraceptionType}
                      onChange={(e) => {
                        const next = e.target.value;
                        setContraceptionType(next);
                        handleSaveSettings({ contraceptionType: next });
                      }}
                      className="bg-transparent text-xs text-app-gray outline-none border-none p-0"
                    >
                      {['Aucune', 'Pilule', 'DIU Cuivre', 'DIU Hormonal', 'Implant', 'Patch', 'Anneau'].map(c => (
                        <option key={c} value={c} className="bg-app-navy">{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <button onClick={() => setShowInstallGuide(true)} className="w-full clue-card flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center text-app-gold"><Smartphone size={24} /></div>
                  <div className="text-left">
                    <p className="font-bold text-black">Installer l'application</p>
                    <p className="text-xs text-black font-bold">Sur votre écran d'accueil</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-app-gray" />
              </button>

              <button onClick={() => signOut(auth)} className="w-full clue-card flex items-center justify-between text-app-gold hover:bg-app-gold/5 transition-colors mt-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-app-gold/10 rounded-2xl flex items-center justify-center"><LogOut size={24} /></div>
                  <span className="font-bold">Se déconnecter</span>
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </main>

      {/* AI Chat Button */}
      <button 
        onClick={() => setIsChatOpen(true)}
        className="fixed right-6 bottom-28 w-14 h-14 bg-app-gold rounded-full shadow-2xl flex items-center justify-center text-app-navy z-40 active:scale-90 transition-all"
      >
        <Sparkles size={28} />
      </button>

      {/* AI Chat Modal */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-app-gold/20 rounded-xl flex items-center justify-center text-app-gold"><Bot size={24} /></div>
                <div>
                  <h2 className="text-lg font-bold">Assistant Fox</h2>
                  <p className="text-[10px] text-app-gold uppercase font-black tracking-widest">IA de Santé Féminine</p>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="p-2 bg-white/5 rounded-full"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {chatMessages.length === 0 && (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 bg-app-gold/10 rounded-full flex items-center justify-center text-app-gold mx-auto"><Sparkles size={32} /></div>
                  <div className="space-y-2">
                    <p className="font-black text-lg text-black">Bonjour ! Comment puis-je vous aider ?</p>
                    <p className="text-sm text-black font-bold px-8">Posez-moi des questions sur votre cycle, vos symptômes ou comment utiliser l'application.</p>
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user' ? "bg-app-gold text-app-navy font-medium" : "bg-app-navy-light border border-white/5"
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isAiLoading && (
                <div className="flex justify-start">
                  <div className="bg-app-navy-light border border-white/5 p-4 rounded-2xl flex gap-1">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-app-gold rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-app-gold rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-app-gold rounded-full" />
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-app-navy border-t border-white/5 pb-safe">
              <div className="flex gap-3 bg-app-navy-light p-2 rounded-2xl border border-white/10">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAiChat()}
                  placeholder="Posez votre question..."
                  className="flex-1 bg-transparent border-none text-white px-4 py-2 outline-none text-sm"
                />
                <button 
                  onClick={handleAiChat}
                  disabled={!chatInput.trim() || isAiLoading}
                  className="w-10 h-10 bg-app-gold rounded-xl flex items-center justify-center text-app-navy disabled:opacity-50 active:scale-90 transition-all"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logging Modal */}
      <AnimatePresence>
        {isLogging && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <button onClick={() => setIsLogging(false)} className="p-2 -ml-2"><ChevronLeft size={28} /></button>
              <div className="text-center">
                <h2 className="text-lg font-bold">{format(selectedDate, 'd MMMM', { locale: fr })}</h2>
                <p className="text-[10px] text-app-gray uppercase font-black tracking-widest">Journal quotidien</p>
              </div>
              <button onClick={() => setIsLogging(false)} className="text-app-gold font-bold text-sm">OK</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar pb-12">
              {/* Flow */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Droplets size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Flux Menstruel</h4>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['Aucun', 'Léger', 'Moyen', 'Fort'].map((f) => (
                    <button 
                      key={f} onClick={() => handleUpdateLog('flow', f)}
                      className={cn("p-4 rounded-2xl text-xs font-bold border-2 transition-all", currentLog?.flow === f ? "clue-pill-active-red" : "clue-pill-inactive")}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {currentLog?.flow && currentLog.flow !== 'Aucun' && (
                  <button onClick={handleAddCycle} className="w-full py-3 bg-app-gold/10 text-app-gold rounded-xl text-xs font-bold active:scale-95 transition-all">
                    Marquer comme début de cycle
                  </button>
                )}
              </div>

              {/* Sex */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Heart size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Activité Sexuelle</h4>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['Aucun', 'Protégé', 'Non-protégé'].map((s) => (
                    <button 
                      key={s} onClick={() => handleUpdateLog('sex', s)}
                      className={cn("p-4 rounded-2xl text-xs font-bold border-2 transition-all", currentLog?.sex === s ? "clue-pill-active-blue" : "clue-pill-inactive")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Temperature */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Thermometer size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Température Basale</h4>
                </div>
                <div className="flex items-center gap-4 bg-slate-100 p-4 rounded-2xl">
                  <input 
                    type="number" step="0.1" placeholder="36.5"
                    value={currentLog?.temperature || ''}
                    onChange={(e) => handleUpdateLog('temperature', parseFloat(e.target.value))}
                    className="flex-1 bg-transparent border-none text-black font-bold text-xl outline-none"
                  />
                  <span className="text-black font-bold">°C</span>
                </div>
              </div>

              {/* Symptoms */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Activity size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Symptômes</h4>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {['Crampes', 'Seins sensibles', 'Peau grasse', 'Ballonnements', 'Fatigue', 'Maux de tête'].map((s) => (
                    <button 
                      key={s} 
                      onClick={() => {
                        const current = currentLog?.symptoms || [];
                        const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
                        handleUpdateLog('symptoms', next);
                      }}
                      className={cn("p-4 rounded-2xl text-xs font-bold border-2 transition-all text-left", currentLog?.symptoms?.includes(s) ? "bg-app-gold/20 text-app-gold border-app-gold/40" : "clue-pill-inactive")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mood */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Smile size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Humeur</h4>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['Heureuse', 'Calme', 'Irritable', 'Triste', 'Anxieuse', 'Épuisée', 'Stressée', 'Neutre'].map((m) => (
                    <button 
                      key={m} onClick={() => handleUpdateLog('mood', m)}
                      className={cn("p-3 rounded-2xl text-[10px] font-bold border-2 transition-all", currentLog?.mood === m ? "bg-app-gold/20 text-app-gold border-app-gold/40" : "clue-pill-inactive")}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Energy */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Zap size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Énergie</h4>
                </div>
                <div className="flex justify-between items-center bg-app-dark-gray p-4 rounded-2xl">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button 
                      key={level} onClick={() => handleUpdateLog('energy', level)}
                      className={cn("w-10 h-10 rounded-full flex items-center justify-center transition-all", currentLog?.energy === level ? "bg-app-gold text-app-navy" : "text-app-gray")}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weight */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gold">
                  <Scale size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Poids</h4>
                </div>
                <div className="flex items-center gap-4 bg-slate-100 p-4 rounded-2xl">
                  <input 
                    type="number" step="0.1" placeholder="60.0"
                    value={currentLog?.weight || ''}
                    onChange={(e) => handleUpdateLog('weight', parseFloat(e.target.value))}
                    className="flex-1 bg-transparent border-none text-black font-bold text-xl outline-none"
                  />
                  <span className="text-black font-bold">kg</span>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-app-gray">
                  <Plus size={20} />
                  <h4 className="text-xs font-black uppercase tracking-widest">Notes personnelles</h4>
                </div>
                <textarea 
                  placeholder="Écrivez ici..."
                  value={currentLog?.notes || ''}
                  onChange={(e) => handleUpdateLog('notes', e.target.value)}
                  className="w-full bg-slate-100 rounded-2xl p-4 text-black font-medium text-sm min-h-[120px] outline-none border-none focus:ring-2 focus:ring-app-gold/30 transition-all"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Learn Modal */}
      <AnimatePresence>
        {showLearn && (
          <motion.div 
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <button onClick={() => setShowLearn(false)} className="p-2 -ml-2"><ChevronLeft size={28} /></button>
              <h2 className="text-lg font-bold">Apprendre</h2>
              <div className="w-10" />
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-app-gold">Comprendre son cycle</h3>
                <div className="clue-card space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-bold text-black">Phase Folliculaire</h4>
                    <p className="text-xs text-black font-bold leading-relaxed">Du 1er jour des règles à l'ovulation. Votre énergie commence à remonter grâce aux œstrogènes.</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-bold text-black">Phase Lutéale</h4>
                    <p className="text-xs text-black font-bold leading-relaxed">Après l'ovulation. La progestérone domine, ce qui peut causer de la fatigue ou des ballonnements.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-app-gold">Conseils Santé</h3>
                <div className="clue-card space-y-4">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 bg-app-gold/10 rounded-xl flex items-center justify-center text-app-gold shrink-0"><Zap size={20} /></div>
                    <div>
                      <h4 className="font-bold text-sm text-black">Alimentation & Cycle</h4>
                      <p className="text-[10px] text-black font-bold mt-1">Privilégiez le magnésium et le fer durant vos règles pour compenser les pertes et réduire les crampes.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-10 h-10 bg-app-gold/10 rounded-xl flex items-center justify-center text-app-gold shrink-0"><Heart size={20} /></div>
                    <div>
                      <h4 className="font-bold text-sm text-black">Sommeil</h4>
                      <p className="text-[10px] text-black font-bold mt-1">Votre température corporelle augmente en phase lutéale, ce qui peut perturber votre sommeil profond.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PIN Setup Modal */}
      <AnimatePresence>
        {showPinSetup && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <button onClick={() => setShowPinSetup(false)} className="p-2 -ml-2"><ChevronLeft size={28} /></button>
              <h2 className="text-lg font-bold">Sécurité PIN</h2>
              <div className="w-10" />
            </div>
            <div className="flex-1 p-6 flex flex-col items-center justify-center space-y-8">
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-black">Définir un code PIN</h3>
                <p className="text-black font-bold text-sm">Choisissez un code à 4 chiffres pour protéger l'accès à vos données sensibles.</p>
              </div>
              <div className="flex gap-4">
                {[1, 2, 3, 4].map((_, i) => (
                  <div key={i} className={cn("w-4 h-4 rounded-full border-2 border-app-gold", pinInput.length > i ? "bg-app-gold" : "bg-transparent")} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map((num) => (
                  <button 
                    key={num}
                    onClick={() => {
                      if (num === 'C') setPinInput('');
                      else if (num === 'OK') {
                        if (pinInput.length === 4) handleSetPin(pinInput);
                        setPinInput('');
                      }
                      else if (pinInput.length < 4) setPinInput(prev => prev + num);
                    }}
                    className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-xl font-bold active:bg-app-gold active:text-app-navy transition-all"
                  >
                    {num}
                  </button>
                ))}
              </div>
              {savedPin && (
                <button 
                  onClick={async () => {
                    setSavedPin(null);
                    await handleSaveSettings({ pin: null });
                    setShowPinSetup(false);
                  }}
                  className="text-red-400 text-sm font-bold"
                >
                  Désactiver le code PIN
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notifications Modal */}
      <AnimatePresence>
        {showNotifications && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <button onClick={() => setShowNotifications(false)} className="p-2 -ml-2"><ChevronLeft size={28} /></button>
              <h2 className="text-lg font-bold">Notifications</h2>
              <div className="w-10" />
            </div>
            <div className="p-6 space-y-4">
              {[
                { id: 'period', label: 'Rappel de règles', desc: 'Alerte 2 jours avant le début prévu' },
                { id: 'ovulation', label: 'Fenêtre de fertilité', desc: 'Alerte au début de la phase fertile' },
                { id: 'contraception', label: 'Rappel contraception', desc: 'Rappel quotidien personnalisé' }
              ].map((item) => (
                <div key={item.id} className="clue-card flex items-center justify-between">
                  <div className="text-left">
                    <p className="font-bold">{item.label}</p>
                    <p className="text-[10px] text-app-gray">{item.desc}</p>
                  </div>
                  <button 
                    onClick={() => {
                      const next = { ...notifications, [item.id]: !notifications[item.id as keyof typeof notifications] };
                      setNotifications(next);
                      handleSaveSettings({ notifications: next });
                    }}
                    className={cn("w-12 h-6 rounded-full transition-all relative", notifications[item.id as keyof typeof notifications] ? "bg-app-gold" : "bg-white/10")}
                  >
                    <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", notifications[item.id as keyof typeof notifications] ? "left-7" : "left-1")} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Partner Sharing Modal */}
      <AnimatePresence>
        {showPartnerSharing && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-app-navy border-b border-white/5 sticky top-0 z-10">
              <button onClick={() => setShowPartnerSharing(false)} className="p-2 -ml-2"><ChevronLeft size={28} /></button>
              <h2 className="text-lg font-bold">Partage Partenaire</h2>
              <div className="w-10" />
            </div>
            <div className="p-6 flex flex-col items-center justify-center space-y-8 flex-1">
              <div className="w-24 h-24 bg-app-gold/10 rounded-full flex items-center justify-center text-app-gold">
                <Heart size={48} />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-black">Partagez votre cycle</h3>
                <p className="text-black font-bold text-sm px-8">Permettez à votre partenaire de consulter vos phases de fertilité et votre humeur en temps réel.</p>
              </div>
              <div className="bg-app-navy-light p-6 rounded-3xl border border-app-gold/10 w-full text-center space-y-4 shadow-sm">
                <p className="text-[10px] text-app-gold font-black uppercase tracking-widest">Votre code de partage</p>
                <p className="text-4xl font-mono font-bold tracking-widest text-black">IMMA-{user.uid.slice(0, 4).toUpperCase()}</p>
                <button 
                  onClick={(e) => {
                    navigator.clipboard.writeText(`https://imma-cycle.care/share/${user.uid}`);
                    const btn = e.currentTarget;
                    const originalText = btn.innerText;
                    btn.innerText = 'Lien copié !';
                    setTimeout(() => btn.innerText = originalText, 2000);
                  }}
                  className="w-full py-3 bg-app-gold text-white rounded-xl font-bold text-sm active:scale-95 transition-all"
                >
                  Copier le lien de partage
                </button>
              </div>
              <p className="text-[10px] text-black font-bold text-center px-12">Le lien expire dans 24 heures pour votre sécurité.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Install Guide Modal */}
      <AnimatePresence>
        {showInstallGuide && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-white border border-app-gold/10 rounded-3xl p-8 w-full max-w-sm space-y-6 text-center shadow-2xl"
            >
              <div className="w-20 h-20 bg-app-gold rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-app-gold/20">
                <Smartphone size={40} className="text-white" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-app-gold-dark">Installer Fox</h2>
                <p className="text-sm text-app-gray">Ajoutez l'application à votre écran d'accueil pour une expérience optimale.</p>
              </div>

              <div className="space-y-4 text-left">
                <div className="bg-slate-50 p-4 rounded-2xl space-y-2 border border-slate-100">
                  <p className="text-xs font-black text-app-gold uppercase tracking-widest">Sur iPhone (Safari)</p>
                  <p className="text-xs text-slate-600 leading-relaxed">Appuyez sur le bouton <span className="font-bold text-slate-900">Partager</span> puis sur <span className="font-bold text-slate-900">"Sur l'écran d'accueil"</span>.</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl space-y-2 border border-slate-100">
                  <p className="text-xs font-black text-app-gold uppercase tracking-widest">Sur Android (Chrome)</p>
                  <p className="text-xs text-slate-600 leading-relaxed">Appuyez sur les <span className="font-bold text-slate-900">trois points</span> puis sur <span className="font-bold text-slate-900">"Installer l'application"</span>.</p>
                </div>
              </div>

              <button 
                onClick={() => setShowInstallGuide(false)}
                className="w-full py-4 bg-app-gold text-white rounded-2xl font-bold active:scale-95 transition-all shadow-lg shadow-app-gold/20"
              >
                J'ai compris
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCycleSettings && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="fixed inset-0 z-50 bg-app-navy flex flex-col pt-safe"
          >
            <div className="p-6 flex justify-between items-center bg-white border-b border-app-gold/5 sticky top-0 z-10">
              <button onClick={() => setShowCycleSettings(false)} className="p-2 -ml-2 text-app-gold"><ChevronLeft size={28} /></button>
              <h2 className="text-lg font-bold text-app-gold-dark">Paramètres du cycle</h2>
              <div className="w-10" />
            </div>
            <div className="p-6 space-y-8">
              <div className="clue-card space-y-4">
                <h3 className="font-bold">Durée moyenne du cycle</h3>
                <div className="flex items-center gap-4">
                  <input 
                    type="range" min="20" max="45"
                    value={avgCycle}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setAvgCycle(val);
                      handleSaveSettings({ avgCycle: val });
                    }}
                    className="flex-1 accent-app-gold"
                  />
                  <span className="text-2xl font-bold text-app-gold w-12">{avgCycle}j</span>
                </div>
                <p className="text-[10px] text-app-gray">Par défaut, Fox calcule automatiquement votre moyenne. Vous pouvez la forcer ici.</p>
              </div>

              <div className="clue-card space-y-4">
                <h3 className="font-bold">Durée moyenne des règles</h3>
                <div className="flex items-center gap-4">
                  <input 
                    type="range" min="1" max="10"
                    value={avgPeriod}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setAvgPeriod(val);
                      handleSaveSettings({ avgPeriod: val });
                    }}
                    className="flex-1 accent-app-gold"
                  />
                  <span className="text-2xl font-bold text-app-gold w-12">{avgPeriod}j</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-app-gold/5 px-6 py-4 flex justify-between items-center z-40 max-w-md mx-auto pb-safe">
        <button 
          onClick={() => setActiveTab('cycle')}
          className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'cycle' ? "text-app-gold scale-110" : "text-app-gray")}
        >
          <Activity size={24} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Cycle</span>
        </button>
        <button 
          onClick={() => setActiveTab('calendar')}
          className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'calendar' ? "text-app-gold scale-110" : "text-app-gray")}
        >
          <Calendar size={24} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Calendrier</span>
        </button>
        <button 
          onClick={() => setActiveTab('analysis')}
          className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'analysis' ? "text-app-gold scale-110" : "text-app-gray")}
        >
          <BarChart3 size={24} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Analyse</span>
        </button>
        <button 
          onClick={() => setActiveTab('plus')}
          className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'plus' ? "text-app-gold scale-110" : "text-app-gray")}
        >
          <Settings size={24} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Plus</span>
        </button>
      </nav>
    </div>
  );
}

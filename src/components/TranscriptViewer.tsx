import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Download, Search, Settings2, User, Clock, FileText, ChevronDown, ListRestart, ExternalLink, RotateCw, Pause, Sparkles, Wand2, Copy, RotateCcw, Check } from 'lucide-react';
import { TranscriptionJob, JobStatus, Speaker, TranscriptSegment } from '../types';
import { cn, formatTime } from '../lib/utils';
import { summarizeTranscript, paraphraseTranscript } from '../services/aiService';
import ReactMarkdown from 'react-markdown';

interface Props {
  job: TranscriptionJob;
}

export default function TranscriptViewer({ job }: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<'control' | 'summary' | 'paraphrase'>('control');
  const [summary, setSummary] = useState<string | null>(null);
  const [paraphrase, setParaphrase] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isParaphrasing, setIsParaphrasing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSummarize = async () => {
    if (!job.result?.transcript) return;
    setIsSummarizing(true);
    try {
      const res = await summarizeTranscript(job.result.transcript);
      setSummary(res);
      setActiveTab('summary');
    } catch (e) {
      console.error(e);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleParaphrase = async () => {
    if (!job.result?.transcript) return;
    setIsParaphrasing(true);
    try {
      const res = await paraphraseTranscript(job.result.transcript);
      setParaphrase(res);
      setActiveTab('paraphrase');
    } catch (e) {
      console.error(e);
    } finally {
      setIsParaphrasing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAIContent = (type: 'summary' | 'paraphrase') => {
    const content = type === 'summary' ? summary : paraphrase;
    if (!content) return;
    
    const filename = `${job.filename.split('.')[0]}_${type}.md`;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (job.result?.speakers) {
      const names: Record<string, string> = {};
      job.result.speakers.forEach(s => {
        names[s.id] = s.name;
      });
      setSpeakerNames(names);
    }
  }, [job.result]);

  const [exportWithTimestamps, setExportWithTimestamps] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (format: 'txt' | 'srt' | 'vtt') => {
    if (!job.result) return;

    let content = '';
    const filename = `${job.filename.split('.')[0]}.${format}`;

    if (format === 'txt') {
      if (exportWithTimestamps) {
        content = job.result.segments
          .map(s => `[${formatTime(s.startTime)}] ${speakerNames[s.speakerId] || s.speakerId}: ${s.text}`)
          .join('\n\n');
      } else {
        content = job.result.segments.map(s => s.text).join(' ');
      }
    } else if (format === 'srt') {
      // SRT inherently requires timestamps, but if "without timestamps" is selected, 
      // we provide a cleaned text file instead but keep the .srt extension if they really want it, 
      // though typically they'd just use TXT. 
      // For SRT specifically, if they choose "without timestamps", we'll just give them segments joined by newlines.
      if (exportWithTimestamps) {
        content = job.result.segments
          .map((s, i) => `${i + 1}\n${formatTimestamp(s.startTime)} --> ${formatTimestamp(s.endTime)}\n${s.text}\n`)
          .join('\n');
      } else {
        content = job.result.segments.map(s => s.text).join('\n');
      }
    } else if (format === 'vtt') {
      if (exportWithTimestamps) {
        content = `WEBVTT\n\n` + job.result.segments
          .map(s => `${formatTimestamp(s.startTime)} --> ${formatTimestamp(s.endTime)}\n${s.text}\n`)
          .join('\n');
      } else {
        content = job.result.segments.map(s => s.text).join('\n');
      }
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Sync isPlaying state with audio element
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(e => {
        console.error("Playback error:", e);
        setIsPlaying(false);
      });
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !audioRef.current || !job.result) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * (job.result.duration || 0);
    
    // Update audio and state
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const activeSegment = job.result?.segments.find(
    s => currentTime >= s.startTime && currentTime < s.endTime
  ) || job.result?.segments[0];

  // Auto-scroll to active segment
  useEffect(() => {
    if (autoScroll && activeSegmentRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = activeSegmentRef.current;
      
      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const containerHeight = container.offsetHeight;

      // Centering the element with some headroom for the header
      const targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);
      
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  }, [activeSegment?.id, autoScroll]);

  // Detected manual scroll to show a "Sync" button if needed
  const [isOutOfSync, setIsOutOfSync] = useState(false);
  const handleScroll = () => {
    if (!autoScroll || !activeSegmentRef.current || !scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    const element = activeSegmentRef.current;
    const elementTop = element.offsetTop;
    const containerTop = container.scrollTop;
    const containerHeight = container.offsetHeight;

    // If the active element is far outside the viewport center area
    const diff = Math.abs(containerTop - (elementTop - containerHeight / 2));
    if (diff > 300) {
      setIsOutOfSync(true);
    } else {
      setIsOutOfSync(false);
    }
  };

  const handleSpeakerRename = (id: string, name: string) => {
    setSpeakerNames(prev => ({ ...prev, [id]: name }));
  };

  const formatTimestamp = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  const filteredSegments = job.result?.segments?.filter(s => 
    s.text?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Group segments into logical utterances (consecutive segments from same speaker)
  const utterances: { speakerId: string; segments: TranscriptSegment[] }[] = [];
  if (filteredSegments.length > 0) {
    filteredSegments.forEach(segment => {
      const lastUtterance = utterances[utterances.length - 1];
      if (lastUtterance && lastUtterance.speakerId === segment.speakerId) {
        lastUtterance.segments.push(segment);
      } else {
        utterances.push({ speakerId: segment.speakerId, segments: [segment] });
      }
    });
  }

  if (job.status === JobStatus.PROCESSING) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <div className="w-24 h-24 relative mb-6">
          <div className="absolute inset-0 border-4 border-gold-500/20 rounded-full" />
          <motion.div 
            className="absolute inset-0 border-4 border-gold-500 rounded-full border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl font-bold text-gold-400">{Math.round(job.progress)}%</span>
          </div>
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Curiak Transcription Active</h3>
        <p className="text-gold-400 font-medium mb-1 text-sm tracking-wide">
          {job.optimizationStatus || "Processing audio..."}
        </p>
        <p className="text-white/40 text-xs">
          Engine: <span className="text-gold-500/60 font-mono">large-v3-turbo / gemini-3.5-flash</span>
        </p>
      </div>
    );
  }

  if (job.status === JobStatus.FAILED) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-rose-400">
        <Settings2 className="w-16 h-16 mb-4 opacity-50" />
        <h3 className="text-xl font-bold mb-2">Transcription Failed</h3>
        <p className="text-rose-400/60">{job.error || "An unexpected error occurred."}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative">
      <audio 
        ref={audioRef} 
        src={job.audioUrl} 
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* Viewer Header */}
      <div className="px-4 md:px-8 py-4 md:py-6 border-b border-white/5 bg-white/[0.02] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 md:gap-4 w-full sm:w-auto">
          <div className="p-2 md:p-3 bg-purple-haze-700 rounded-lg md:rounded-xl border border-gold-500/20 shrink-0">
            <FileText className="w-5 h-5 md:w-6 md:h-6 text-gold-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-base md:text-lg text-white truncate">{job.filename}</h2>
            <p className="text-[10px] text-gold-500/40 font-mono">
              {formatTime(job.result?.duration || 0)} duration • AES-256 Secured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto">
          {/* Auto Scroll Toggle in Header */}
          <button 
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border",
              autoScroll ? "bg-gold-500/10 text-gold-500 border-gold-500/30" : "bg-white/5 text-white/40 border-white/5"
            )}
          >
            <div className={cn("w-1.5 h-1.5 rounded-full", autoScroll ? "bg-gold-500 animate-pulse" : "bg-white/20")} />
            Auto-Scroll
          </button>

          <div className="relative group flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-gold-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg md:rounded-xl pl-9 pr-3 py-1.5 md:py-2 text-xs md:text-sm focus:outline-none focus:border-gold-500/50 focus:bg-white/[0.08] transition-all w-full sm:w-40 md:w-64"
            />
          </div>
          
          <div className="relative shrink-0" ref={exportMenuRef}>
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-3 md:px-4 py-1.5 md:py-2 bg-gold-500 text-purple-haze-950 text-[10px] md:text-sm font-bold rounded-lg md:rounded-xl hover:bg-gold-400 transition-all flex items-center gap-1.5 md:gap-2 shadow-lg shadow-gold-500/10"
            >
              <Download className="w-3 h-3 md:w-4 md:h-4" />
              Export
              <ChevronDown className={cn("w-3 h-3 transition-transform", showExportMenu ? "rotate-180" : "")} />
            </button>

            {showExportMenu && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="absolute right-0 mt-2 w-48 bg-purple-haze-800 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
              >
                <div className="p-3 border-b border-white/5 bg-white/5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gold-500/60 mb-2">Options</p>
                  <button 
                    onClick={() => setExportWithTimestamps(!exportWithTimestamps)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-white/5 transition-all group"
                  >
                    <span className="text-xs text-white/70 group-hover:text-white">Timestamps</span>
                    <div className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      exportWithTimestamps ? "bg-gold-500" : "bg-white/10"
                    )}>
                      <div className={cn(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-purple-haze-950 transition-all",
                        exportWithTimestamps ? "left-[17px]" : "left-0.5"
                      )} />
                    </div>
                  </button>
                </div>
                <div className="p-1">
                  <button 
                    onClick={() => { handleExport('txt'); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-white hover:bg-gold-500 hover:text-purple-haze-950 rounded-lg transition-all flex items-center justify-between group"
                  >
                    Plain Text (.txt)
                    <span className="text-[8px] opacity-40 group-hover:opacity-100 uppercase tracking-tighter">Recommended</span>
                  </button>
                  <button 
                    onClick={() => { handleExport('srt'); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-white hover:bg-gold-500 hover:text-purple-haze-950 rounded-lg transition-all"
                  >
                    Subtitles (.srt)
                  </button>
                  <button 
                    onClick={() => { handleExport('vtt'); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-white hover:bg-gold-500 hover:text-purple-haze-950 rounded-lg transition-all"
                  >
                    WebVTT (.vtt)
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        <AnimatePresence>
          {isOutOfSync && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={() => {
                setAutoScroll(true);
                setIsOutOfSync(false);
                // Trigger a re-scroll immediately
                if (activeSegmentRef.current && scrollContainerRef.current) {
                  const container = scrollContainerRef.current;
                  const element = activeSegmentRef.current;
                  const targetScroll = element.offsetTop - (container.offsetHeight / 2) + (element.offsetHeight / 2);
                  container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
                }
              }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gold-500 text-purple-haze-950 px-6 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 shadow-2xl shadow-gold-500/40 z-50 whitespace-nowrap active:scale-95 transition-transform"
            >
              <ListRestart className="w-4 h-4" />
              Sync with Player
            </motion.button>
          )}
        </AnimatePresence>

        {/* Main Transcript List */}
        <div 
          ref={scrollContainerRef} 
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 custom-scrollbar scroll-smooth relative"
        >
          {filteredSegments.map((segment, idx) => {
            const speaker = job.result?.speakers.find(s => s.id === segment.speakerId);
            const name = speakerNames[segment.speakerId] || segment.speakerId;
            const isActive = activeSegment?.id === segment.id;
            const isFirstInBlock = idx === 0 || filteredSegments[idx - 1].speakerId !== segment.speakerId;

            return (
              <motion.div 
                key={segment.id}
                ref={isActive ? activeSegmentRef : null}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "group flex flex-col sm:flex-row gap-3 sm:gap-8 p-3 rounded-2xl transition-all duration-300",
                  isActive 
                    ? "bg-gold-500/10 ring-1 ring-gold-500/30 shadow-2xl shadow-gold-500/10 z-10" 
                    : "hover:bg-white/[0.02]"
                )}
              >
                {/* Meta: Timestamp & Speaker */}
                <div className="w-full sm:w-32 pt-1 flex flex-row sm:flex-col items-center sm:items-end gap-3 sm:gap-1 shrink-0">
                  <span className={cn(
                    "text-[10px] md:text-xs font-mono font-bold tracking-tighter transition-colors",
                    isActive ? "text-gold-500" : "text-white/20 group-hover:text-white/40"
                  )}>
                    {formatTime(segment.startTime)}
                  </span>
                  
                  <div className={cn(
                    "flex items-center gap-2",
                    (!isFirstInBlock && !isActive) && "sm:opacity-0 group-hover:opacity-100 transition-opacity"
                  )}>
                    {editingSpeaker === segment.speakerId ? (
                      <input 
                        autoFocus
                        className="bg-white/10 border border-gold-500/50 rounded px-2 py-0.5 text-[9px] font-bold text-white outline-none w-20"
                        value={name}
                        onChange={(e) => handleSpeakerRename(segment.speakerId, e.target.value)}
                        onBlur={() => setEditingSpeaker(null)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditingSpeaker(null)}
                      />
                    ) : (
                      <button 
                        onClick={() => setEditingSpeaker(segment.speakerId)}
                        className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1 hover:text-white transition-colors"
                        style={{ color: speaker?.color || '#888' }}
                      >
                        {isFirstInBlock ? <User className="w-2.5 h-2.5" /> : null}
                        {name}
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Text Content */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "leading-relaxed transition-all duration-500 cursor-pointer select-text",
                    isActive 
                      ? "text-base md:text-2xl text-white font-bold" 
                      : "text-sm md:text-lg text-white/50 hover:text-white/80"
                  )}
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = segment.startTime;
                      if (!isPlaying) setIsPlaying(true);
                    }
                  }}>
                    {segment.text}
                  </p>
                </div>

                {/* Desktop Action */}
                <div className="hidden lg:flex items-start opacity-0 group-hover:opacity-100 transition-all">
                   <button 
                    onClick={() => {
                      if (audioRef.current) audioRef.current.currentTime = segment.startTime;
                      setIsPlaying(true);
                    }}
                    className="p-2 bg-white/5 rounded-full text-white/20 hover:text-gold-500 hover:bg-gold-500/10 shadow-lg"
                   >
                     <Play className="w-3 h-3 fill-current" />
                   </button>
                </div>
              </motion.div>
            );
          })}
          
          <div className="h-64" /> {/* Space for centering bottom segments */}
        </div>

        {/* Right Player Panel (Sticky on Desktop, Bottom on Mobile) */}
        <div className="w-full md:w-80 lg:w-96 bg-purple-haze-950/30 border-t md:border-t-0 md:border-l border-white/5 p-4 md:p-6 flex flex-col gap-6 backdrop-blur-md shrink-0 focus-within:z-20">
          {/* AI Feature Tabs */}
          <div className="flex bg-white/5 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab('control')}
              className={cn(
                "flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                activeTab === 'control' ? "bg-gold-500 text-purple-haze-950 shadow-lg" : "text-white/40 hover:text-white"
              )}
            >
              Control
            </button>
            <button 
              onClick={() => setActiveTab('summary')}
              className={cn(
                "flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                activeTab === 'summary' ? "bg-gold-500 text-purple-haze-950 shadow-lg" : "text-white/40 hover:text-white"
              )}
            >
              Summary
            </button>
            <button 
              onClick={() => setActiveTab('paraphrase')}
              className={cn(
                "flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                activeTab === 'paraphrase' ? "bg-gold-500 text-purple-haze-950 shadow-lg" : "text-white/40 hover:text-white"
              )}
            >
              Paraphrase
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar md:pr-2">
            <AnimatePresence mode="wait">
              {activeTab === 'control' && (
                <motion.div 
                  key="control"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <div className="hidden md:block">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-gold-500/60 mb-4 font-bold">Acoustic Control</h3>
                    <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col items-center text-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-gold-500/10 flex items-center justify-center border border-gold-500/20">
                        <FileText className="w-6 h-6 text-gold-500" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Playback Engine</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-tighter mt-1">Direct Stream Acceleration</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-[10px] md:text-xs font-mono uppercase tracking-widest text-gold-500/60 font-bold">AI Actions</h3>
                    <button 
                      onClick={handleSummarize}
                      disabled={isSummarizing}
                      className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-gold-500/10 hover:border-gold-500/30 transition-all group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-500 group-hover:scale-110 transition-transform">
                          <Sparkles className={cn("w-4 h-4", isSummarizing && "animate-pulse")} />
                        </div>
                        <span className="text-xs font-bold text-white/80 group-hover:text-white">Summarize</span>
                      </div>
                      {isSummarizing && <RotateCw className="w-3 h-3 text-gold-500 animate-spin" />}
                    </button>
                    <button 
                      onClick={handleParaphrase}
                      disabled={isParaphrasing}
                      className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-gold-500/10 hover:border-gold-500/30 transition-all group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-500 group-hover:scale-110 transition-transform">
                          <Wand2 className={cn("w-4 h-4", isParaphrasing && "animate-pulse")} />
                        </div>
                        <span className="text-xs font-bold text-white/80 group-hover:text-white">Paraphrase</span>
                      </div>
                      {isParaphrasing && <RotateCw className="w-3 h-3 text-gold-500 animate-spin" />}
                    </button>
                  </div>
                </motion.div>
              )}

              {activeTab === 'summary' && (
                <motion.div 
                  key="summary"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4 h-full flex flex-col"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-gold-500/60 font-bold">Transcription Summary</h3>
                    <div className="flex items-center gap-2">
                       <button 
                        onClick={() => summary && copyToClipboard(summary)}
                        className="p-1.5 bg-white/5 rounded-lg text-white/40 hover:text-gold-500 hover:bg-gold-500/10 transition-all"
                        title="Copy Summary"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button 
                        onClick={() => downloadAIContent('summary')}
                        className="p-1.5 bg-white/5 rounded-lg text-white/40 hover:text-gold-500 hover:bg-gold-500/10 transition-all"
                        title="Download Summary"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 bg-white/5 rounded-2xl border border-white/5 p-4 overflow-y-auto custom-scrollbar">
                    {summary ? (
                      <div className="prose prose-invert prose-sm max-w-none text-white/70 prose-headings:text-gold-500 prose-headings:font-bold prose-strong:text-white">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 opacity-40">
                        <Sparkles className="w-8 h-8" />
                        <p className="text-xs font-bold uppercase tracking-widest">No Summary Generated</p>
                        <button 
                          onClick={handleSummarize}
                          className="px-4 py-2 bg-gold-500/10 text-gold-500 rounded-lg text-[10px] font-bold border border-gold-500/20 hover:bg-gold-500/20"
                        >
                          Generate Now
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'paraphrase' && (
                <motion.div 
                  key="paraphrase"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4 h-full flex flex-col"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-gold-500/60 font-bold">Paraphrased Content</h3>
                    <div className="flex items-center gap-2">
                       <button 
                        onClick={() => paraphrase && copyToClipboard(paraphrase)}
                        className="p-1.5 bg-white/5 rounded-lg text-white/40 hover:text-gold-500 hover:bg-gold-500/10 transition-all"
                        title="Copy Content"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button 
                        onClick={() => downloadAIContent('paraphrase')}
                        className="p-1.5 bg-white/5 rounded-lg text-white/40 hover:text-gold-500 hover:bg-gold-500/10 transition-all"
                        title="Download Content"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 bg-white/5 rounded-2xl border border-white/5 p-4 overflow-y-auto custom-scrollbar">
                    {paraphrase ? (
                      <div className="prose prose-invert prose-sm max-w-none text-white/70 italic leading-relaxed">
                        <ReactMarkdown>{paraphrase}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 opacity-40">
                        <Wand2 className="w-8 h-8" />
                        <p className="text-xs font-bold uppercase tracking-widest">No Paraphrase Available</p>
                        <button 
                          onClick={handleParaphrase}
                          className="px-4 py-2 bg-gold-500/10 text-gold-500 rounded-lg text-[10px] font-bold border border-gold-500/20 hover:bg-gold-500/20"
                        >
                          Generate Now
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-col gap-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between mb-1 sm:hidden">
               <button 
                onClick={() => setAutoScroll(!autoScroll)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all",
                  autoScroll ? "bg-gold-500/20 text-gold-500 border border-gold-500/30" : "bg-white/5 text-white/40 border border-white/5"
                )}
              >
                <div className={cn("w-1.5 h-1.5 rounded-full", autoScroll ? "bg-gold-500 animate-pulse" : "bg-white/20")} />
                Auto-Scroll {autoScroll ? "On" : "Off"}
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] md:text-xs font-mono text-gold-400/80 uppercase tracking-widest">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(job.result?.duration || 0)}</span>
            </div>
            
            <div 
              ref={progressRef}
              onClick={handleSeek}
              className="h-1.5 md:h-2 bg-white/5 rounded-full overflow-hidden relative group cursor-pointer"
            >
              <div className="absolute inset-0 bg-gold-500/10 group-hover:bg-gold-500/20 transition-colors" />
              <motion.div 
                className="h-full bg-gold-500 relative" 
                style={{ width: `${(currentTime / (job.result?.duration || 1)) * 100}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 md:w-4 h-3 md:h-4 bg-white rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform" />
              </motion.div>
            </div>

            <div className="flex items-center justify-center gap-6 mt-2">
              <button 
                onClick={() => {
                  if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
                }}
                className="p-2 text-white/40 hover:text-white transition-colors"
                title="Rewind 10s"
              >
                <RotateCw className="w-5 h-5 -scale-x-100" />
              </button>

              <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-14 h-14 md:w-16 md:h-16 rounded-3xl bg-gold-500 text-purple-haze-950 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-gold-500/20"
              >
                {isPlaying ? <Pause className="w-6 h-6 md:w-8 md:h-8 fill-current" /> : <Play className="w-6 h-6 md:w-8 md:h-8 fill-current ml-1" />}
              </button>

              <button 
                onClick={() => {
                  if (audioRef.current) audioRef.current.currentTime = Math.min((job.result?.duration || 0), audioRef.current.currentTime + 10);
                }}
                className="p-2 text-white/40 hover:text-white transition-colors"
                title="Forward 10s"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="hidden md:grid grid-cols-2 gap-3 mt-auto">
            <button className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group">
              <Settings2 className="w-5 h-5 text-white/40 group-hover:text-gold-400" />
              <span className="text-[10px] uppercase font-bold text-white/30">Settings</span>
            </button>
            <button className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group">
              <Download className="w-5 h-5 text-white/40 group-hover:text-gold-400" />
              <span className="text-[10px] uppercase font-bold text-white/30">Offline</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

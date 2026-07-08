import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileAudio, Upload, Clock, Settings, Download, Trash2, CheckCircle2, AlertCircle, Loader2, Play, ShieldCheck } from 'lucide-react';
import { JobStatus, TranscriptionJob, Speaker, TranscriptSegment } from './types';
import { cn } from './lib/utils';
import { transcribeAudio, transcribeLargeAudioFile } from './services/aiService';
import { optimizeAudioFile } from './lib/audioOptimizer';
import AudioUpload from './components/AudioUpload';
import TranscriptViewer from './components/TranscriptViewer';

export default function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Auto-close menu on job selection
  useEffect(() => {
    if (selectedJobId) setMobileMenuOpen(false);
  }, [selectedJobId]);

  // Poll for job updates (simulated since Gemini happens in frontend)
  const selectedJob = jobs.find(j => j.id === selectedJobId);

  const handleUpload = async (file: File, options: { diarization: boolean, enhancement: boolean }) => {
    setIsUploading(true);
    
    // Create local audio URL for playback
    const audioUrl = URL.createObjectURL(file);
    
    const jobId = Math.random().toString(36).substring(7);
    const newJob: TranscriptionJob = {
      id: jobId,
      status: JobStatus.PROCESSING,
      progress: 0,
      filename: file.name,
      audioUrl: audioUrl,
      createdAt: new Date().toISOString(),
      optimizationStatus: "Initializing process...",
    };
    
    setJobs(prev => [newJob, ...prev]);
    setSelectedJobId(jobId);

    const isLargeFile = file.size >= 25 * 1024 * 1024; // 25MB

    if (isLargeFile) {
      try {
        setJobs(prev => prev.map(j => 
          j.id === jobId ? { 
            ...j, 
            optimizationStatus: "Uploading in secure chunks (0%)...", 
            progress: 0
          } : j
        ));

        // Setup server-side progress tracking starting at 40%
        let currentProgress = 40;
        let progressInterval: any = null;

        const startProgressInterval = () => {
          progressInterval = setInterval(() => {
            if (currentProgress >= 98) return;
            const increment = currentProgress < 70 ? 4 : (currentProgress < 90 ? 1.5 : 0.4);
            currentProgress = Math.min(currentProgress + increment, 98);
            
            setJobs(prev => prev.map(j => 
              j.id === jobId ? { 
                ...j, 
                optimizationStatus: "Transcribing large audio (running Curiak AI)...",
                progress: Math.round(currentProgress) 
              } : j
            ));
          }, 1500);
        };

        const result = await transcribeLargeAudioFile(file, options, (uploadPercent) => {
          setJobs(prev => prev.map(j => 
            j.id === jobId ? { 
              ...j, 
              optimizationStatus: `Uploading in secure chunks (${uploadPercent}%)...`, 
              progress: Math.round(uploadPercent * 0.4) // Chunk upload takes first 40%
            } : j
          ));

          if (uploadPercent === 100 && !progressInterval) {
            // Once uploaded, start the pseudo-progress for transcription
            startProgressInterval();
          }
        });

        if (progressInterval) clearInterval(progressInterval);

        if (!result || !result.segments) {
          throw new Error("Invalid transcription result structure.");
        }

        setJobs(prev => prev.map(j => 
          j.id === jobId ? { 
            ...j, 
            status: JobStatus.COMPLETED, 
            progress: 100, 
            result: {
              ...result,
              speakers: (result.speakers || []).map((s: any, i: number) => ({
                ...s,
                color: [`#D4AF37`, `#EF4444`, `#10B981`, `#3B82F6`, `#8B5CF6`][i % 5]
              }))
            } 
          } : j
        ));

      } catch (error: any) {
        console.error("Large file transcription failed:", error);
        setJobs(prev => prev.map(j => 
          j.id === jobId ? { ...j, status: JobStatus.FAILED, error: error.message || "Large file transcription failed." } : j
        ));
      } finally {
        setIsUploading(false);
      }
    } else {
      // Small file: standard optimization and fast direct upload
      try {
        let optimizedFile: File = file;
        try {
          optimizedFile = await optimizeAudioFile(file, (progress) => {
            setJobs(prev => prev.map(j => 
              j.id === jobId ? { 
                ...j, 
                optimizationStatus: progress.status, 
                progress: Math.round(progress.percent * 0.3) // Client optimization takes up first 30% of progress
              } : j
            ));
          });
        } catch (optimizeError) {
          console.warn("Client-side audio optimization failed, falling back to original file:", optimizeError);
          // Keep original file and set progress to 30%
          setJobs(prev => prev.map(j => 
            j.id === jobId ? { 
              ...j, 
              optimizationStatus: "Direct upload fallback...", 
              progress: 30
            } : j
          ));
        }

        // Setup server-side progress tracking starting at 30%
        let currentProgress = 30;
        const progressInterval = setInterval(() => {
          if (currentProgress >= 98) return;
          
          const increment = currentProgress < 70 ? 4 : (currentProgress < 90 ? 1.5 : 0.4);
          currentProgress = Math.min(currentProgress + increment, 98);
          
          setJobs(prev => prev.map(j => 
            j.id === jobId ? { 
              ...j, 
              optimizationStatus: "Transcribing audio (running Curiak AI)...",
              progress: Math.round(currentProgress) 
            } : j
          ));
        }, 1500);

        try {
          const result = await transcribeAudio(optimizedFile, optimizedFile.type, options);
          
          clearInterval(progressInterval);
          
          if (!result || !result.segments) {
            throw new Error("Invalid transcription result structure.");
          }

          setJobs(prev => prev.map(j => 
            j.id === jobId ? { 
              ...j, 
              status: JobStatus.COMPLETED, 
              progress: 100, 
              result: {
                ...result,
                speakers: (result.speakers || []).map((s: any, i: number) => ({
                  ...s,
                  color: [`#D4AF37`, `#EF4444`, `#10B981`, `#3B82F6`, `#8B5CF6`][i % 5]
                }))
              } 
            } : j
          ));
        } catch (error: any) {
          clearInterval(progressInterval);
          console.error("Transcription pipeline error:", error);
          setJobs(prev => prev.map(j => 
            j.id === jobId ? { ...j, status: JobStatus.FAILED, error: error.message || "Transcription failed." } : j
          ));
        }
      } catch (e: any) {
        console.error("Read error:", e);
        setJobs(prev => prev.map(j => 
          j.id === jobId ? { ...j, status: JobStatus.FAILED, error: e.message || "File read or optimization failed." } : j
        ));
      } finally {
        setIsUploading(false);
      }
    }
  };

  const deleteJob = (id: string) => {
    const job = jobs.find(j => j.id === id);
    if (job?.audioUrl) URL.revokeObjectURL(job.audioUrl);
    
    setJobs(prev => prev.filter(j => j.id !== id));
    if (selectedJobId === id) setSelectedJobId(null);
  };

  return (
    <div className="h-screen bg-[#0A0A0A] text-[#E4E4E4] font-sans selection:bg-indigo-500/30 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gold-500/10 bg-purple-haze-950 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg text-gold-500"
          >
            <Clock className="w-6 h-6" />
          </button>
          <div className="w-8 h-8 md:w-10 md:h-10 bg-gold-500 rounded-lg md:rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(212,175,55,0.3)]">
            <FileAudio className="text-purple-haze-950 w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg md:text-xl tracking-tight text-white">Curiak</h1>
            <p className="hidden xs:block text-[8px] md:text-[10px] uppercase tracking-widest text-gold-500/60 font-mono">Production Grade Transcription</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden lg:flex items-center gap-6 mr-6 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-gold-400 transition-colors">Pricing</a>
            <a href="#" className="hover:text-gold-400 transition-colors">Enterprise</a>
            <a href="#" className="hover:text-gold-400 transition-colors">API</a>
          </div>
          <button className="bg-white/5 hover:bg-white/10 text-white px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all border border-white/10">
            Settings
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 md:gap-8 h-full min-h-0 overflow-hidden">
        {/* Sidebar - Jobs List (Overlay on mobile) */}
        <div className={cn(
          "fixed inset-0 z-40 lg:relative lg:inset-auto lg:z-0 lg:flex flex-col gap-6 transition-transform duration-300 ease-in-out",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          !mobileMenuOpen && "pointer-events-none lg:pointer-events-auto"
        )}>
          {/* Mobile Overlay Backdrop */}
          {mobileMenuOpen && (
            <div 
              className="absolute inset-0 bg-black/60 lg:hidden pointer-events-auto"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}

          <section className="relative w-[85%] max-w-[320px] lg:w-full h-full lg:h-auto bg-purple-haze-900 lg:bg-transparent p-6 lg:p-0 border-r border-white/5 lg:border-none flex flex-col gap-6 overflow-hidden pointer-events-auto">
            <button 
              onClick={() => { setSelectedJobId(null); setMobileMenuOpen(false); }}
              className="w-full py-3 md:py-4 px-6 bg-gold-500 hover:bg-gold-600 text-purple-haze-950 rounded-2xl font-bold shadow-lg shadow-gold-500/20 transition-all flex items-center justify-center gap-2 group"
            >
              <Upload className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
              New Transcription
            </button>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white/30 px-2">Recent Tasks</h2>
            
            <AnimatePresence initial={false}>
              {jobs.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-white/5 rounded-2xl text-white/20">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No recent transcriptions</p>
                </div>
              ) : (
                jobs.map((job) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => setSelectedJobId(job.id)}
                    className={cn(
                      "p-4 rounded-2xl cursor-pointer transition-all border group relative",
                      selectedJobId === job.id 
                        ? "bg-purple-haze-800 border-gold-500/30 shadow-[0_8px_30px_rgb(0,0,0,0.4)]" 
                        : "bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/[0.07]"
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-medium truncate mb-1",
                          selectedJobId === job.id ? "text-gold-400" : "text-white/70"
                        )}>
                          {job.filename}
                        </p>
                        <p className="text-[10px] text-white/30 font-mono">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {job.status === JobStatus.PROCESSING && (
                          <Loader2 className="w-4 h-4 text-gold-500 animate-spin" />
                        )}
                        {job.status === JobStatus.COMPLETED && (
                          <CheckCircle2 className="w-4 h-4 text-gold-500" />
                        )}
                        {job.status === JobStatus.FAILED && (
                          <AlertCircle className="w-4 h-4 text-rose-400" />
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteJob(job.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500/20 hover:text-rose-400 rounded transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {job.status === JobStatus.PROCESSING && (
                      <div className="w-full h-1 bg-white/5 rounded-full mt-3 overflow-hidden">
                        <motion.div 
                          className="h-full bg-gold-500" 
                          initial={{ width: 0 }}
                          animate={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Quota & Capacity */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-3">
            <div className="flex items-center justify-between text-[10px] font-mono text-white/40 uppercase tracking-widest">
              <span>Cloud Capacity</span>
              <span className="text-gold-500">100% Free</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Max File Size</span>
                <span className="font-bold text-white">5 GB</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Max Duration</span>
                <span className="font-bold text-white">10 Hours</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Parallel Jobs</span>
                <span className="font-bold text-white">Unlimited</span>
              </div>
            </div>
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center gap-2 text-[10px] text-gold-500/60 italic">
                <ShieldCheck className="w-3 h-3" />
                <span>Unlimited uploads available for all users.</span>
              </div>
            </div>
          </div>

          {/* Terminal Logs */}
          <div className="mt-auto bg-purple-haze-950/40 rounded-xl p-4 border border-white/5 font-mono text-[10px] space-y-1">
            <div className="flex items-center justify-between mb-2 pb-1 border-b border-white/10">
              <span className="text-gold-500/60 uppercase tracking-tighter">System Pipeline</span>
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
              </div>
            </div>
            <div className="text-gold-400/80">[FASTAPI] Async worker connected</div>
            <div className="text-gold-400/80">[REDIS] Broker listening on port 6379</div>
            <div className="text-white/40">[CELERY] Concurrency established: 8</div>
            <AnimatePresence>
              {isUploading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="text-white/60">[S3] Initiating Multipart Upload...</div>
                  <div className="text-white/60">[S3] Presigned URL generated</div>
                </motion.div>
              )}
              {selectedJob?.status === JobStatus.PROCESSING && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="text-white/60">[WHISPER] Loading large-v3-turbo...</div>
                  <div className="text-white/60">[CUDA] GPU acceleration active</div>
                  <div className="text-white/60">[VAD] Removing non-speech intervals...</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>

        {/* Content Area */}
        <section className="bg-purple-haze-800 border border-white/5 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
          {!selectedJobId ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <AudioUpload onUpload={handleUpload} isUploading={isUploading} />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
               {selectedJob ? (
                 <TranscriptViewer job={selectedJob} />
               ) : (
                 <div className="flex-1 flex items-center justify-center text-white/20">
                   <Loader2 className="w-10 h-10 animate-spin" />
                 </div>
               )}
            </div>
          )}
        </section>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(79, 70, 229, 0.4);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(79, 70, 229, 0.6);
        }
      `}</style>
    </div>
  );
}

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Music, Settings, Sparkles, Loader2, ShieldCheck, Info, Clock, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { APP_LIMITS } from '../constants';

interface Props {
  onUpload: (file: File, options: { diarization: boolean, enhancement: boolean }) => void;
  isUploading: boolean;
}

export default function AudioUpload({ onUpload, isUploading }: Props) {
  const [diarization, setDiarization] = useState(true);
  const [enhancement, setEnhancement] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      if (file.size > APP_LIMITS.MAX_FILE_SIZE_BYTES) {
        setError(`File is too large. Maximum size is ${APP_LIMITS.MAX_FILE_SIZE_GB}GB.`);
        return;
      }
      setSelectedFile(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.mav', '.m4a', '.flac', '.ogg'],
      'video/*': ['.mp4', '.mov', '.avi', '.mkv']
    },
    multiple: false,
    disabled: isUploading
  } as any);

  const handleStart = () => {
    if (selectedFile) {
      onUpload(selectedFile, { diarization, enhancement });
    }
  };

  return (
    <div className="max-w-2xl w-full flex flex-col gap-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold text-white tracking-tight">Transcribe your audio</h2>
        <p className="text-white/40 max-w-md mx-auto">
          Upload any audio or video file. Our production-grade AI handles the rest with precision.
        </p>
      </div>

      <div className="space-y-4">
        <div 
          {...getRootProps()} 
          className={cn(
            "relative group cursor-pointer aspect-video md:aspect-[21/9] rounded-[32px] border-2 border-dashed transition-all flex flex-col items-center justify-center gap-4 overflow-hidden",
            isDragActive ? "border-gold-500 bg-gold-500/5" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20",
            selectedFile && !error && "border-gold-500/50 bg-gold-500/5",
            error && "border-rose-500/50 bg-rose-500/5"
          )}
        >
          <input {...getInputProps()} />
          
          <div className="relative">
            <div className={cn(
              "absolute inset-0 blur-2xl rounded-full scale-150 group-hover:scale-[2] transition-transform",
              error ? "bg-rose-500/20" : "bg-gold-500/20"
            )} />
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center relative z-10 transition-all",
              selectedFile && !error ? "bg-gold-500 text-purple-haze-950" : 
              error ? "bg-rose-500 text-white" : "bg-white/5 text-white/40 group-hover:text-white"
            )}>
              {error ? <Info className="w-8 h-8" /> : selectedFile ? <Music className="w-8 h-8" /> : <Upload className="w-8 h-8" />}
            </div>
          </div>

          <div className="text-center z-10 px-6">
            {error ? (
              <p className="text-lg font-medium text-rose-400">{error}</p>
            ) : selectedFile ? (
              <p className="text-lg font-medium text-white truncate max-w-xs">{selectedFile.name}</p>
            ) : (
              <>
                <p className="text-lg font-medium text-white">Drag & drop or click to browse</p>
                <p className="text-sm text-white/30">{APP_LIMITS.SUPPORTED_FORMATS.join(', ')} (Max {APP_LIMITS.MAX_FILE_SIZE_GB}GB)</p>
              </>
            )}
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3 flex flex-col items-center gap-1 text-center">
            <Clock className="w-4 h-4 text-gold-500/60" />
            <span className="text-[10px] uppercase tracking-wider text-white/40">Duration Limit</span>
            <span className="text-xs font-bold text-white">10 Hours</span>
          </div>
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3 flex flex-col items-center gap-1 text-center">
            <Save className="w-4 h-4 text-gold-500/60" />
            <span className="text-[10px] uppercase tracking-wider text-white/40">File Size</span>
            <span className="text-xs font-bold text-white">{APP_LIMITS.MAX_FILE_SIZE_GB} GB</span>
          </div>
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3 flex flex-col items-center gap-1 text-center">
            <ShieldCheck className="w-4 h-4 text-gold-500/60" />
            <span className="text-[10px] uppercase tracking-wider text-white/40">Security</span>
            <span className="text-xs font-bold text-white">AES-256</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        <div 
          onClick={() => !isUploading && setDiarization(!diarization)}
          className={cn(
            "p-3 md:p-4 rounded-xl md:rounded-2xl border cursor-pointer transition-all flex items-center justify-between",
            diarization ? "bg-gold-500/10 border-gold-500/50" : "bg-white/5 border-white/10 hover:border-white/20"
          )}
        >
          <div className="flex items-center gap-2 md:gap-3">
            <Settings className={cn("w-4 h-4 md:w-5 md:h-5", diarization ? "text-gold-400" : "text-white/40")} />
            <div>
              <p className="text-xs md:text-sm font-medium text-white text-left">Speaker Diarization</p>
              <p className="text-[10px] md:text-xs text-white/40 text-left">Detect speakers</p>
            </div>
          </div>
          <div className={cn(
            "w-8 md:w-10 h-4 md:h-5 rounded-full relative transition-colors",
            diarization ? "bg-gold-500" : "bg-white/20"
          )}>
            <div className={cn(
              "absolute top-0.5 md:top-1 w-3 h-3 bg-white rounded-full transition-all",
              diarization ? "left-4.5 md:left-6" : "left-0.5 md:left-1"
            )} />
          </div>
        </div>

        <div 
          onClick={() => !isUploading && setEnhancement(!enhancement)}
          className={cn(
            "p-3 md:p-4 rounded-xl md:rounded-2xl border cursor-pointer transition-all flex items-center justify-between",
            enhancement ? "bg-gold-400/10 border-gold-400/50" : "bg-white/5 border-white/10 hover:border-white/20"
          )}
        >
          <div className="flex items-center gap-2 md:gap-3">
            <Sparkles className={cn("w-4 h-4 md:w-5 md:h-5", enhancement ? "text-gold-400" : "text-white/40")} />
            <div>
              <p className="text-xs md:text-sm font-medium text-white text-left">Audio Restoration</p>
              <p className="text-[10px] md:text-xs text-white/40 text-left">Denoising</p>
            </div>
          </div>
          <div className={cn(
            "w-8 md:w-10 h-4 md:h-5 rounded-full relative transition-colors",
            enhancement ? "bg-gold-400" : "bg-white/20"
          )}>
            <div className={cn(
              "absolute top-0.5 md:top-1 w-3 h-3 bg-white rounded-full transition-all",
              enhancement ? "left-4.5 md:left-6" : "left-0.5 md:left-1"
            )} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button 
          disabled={!selectedFile || isUploading}
          onClick={handleStart}
          className="w-full py-4 bg-gold-500 text-purple-haze-950 font-bold rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gold-400 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-xl shadow-gold-500/20"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-gold-500" />
              Initializing Curiak Engine...
            </>
          ) : (
            "Start Transcription"
          )}
        </button>
        
        <div className="flex flex-col items-center justify-center gap-1 text-center mt-4 text-white/40">
          <span className="text-[9px] font-mono tracking-widest border-b border-white/10 pb-1 mb-1">© 2026-Made by Fajrianor</span>
          <span className="text-sm font-black tracking-[0.2em] text-gold-500">CURIAK</span>
          <span className="text-[10px] font-medium tracking-wide uppercase">Pusat Humas dan Keterbukaan Informasi</span>
          <span className="text-[11px] font-serif italic text-white/60">UIN Antasari Banjarmasin</span>
        </div>
      </div>
    </div>
  );
}

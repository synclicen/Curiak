export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface Speaker {
  id: string;
  name: string;
  color: string;
}

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  speakerId: string;
  text: string;
  confidence: number;
}

export interface TranscriptionJob {
  id: string;
  status: JobStatus;
  progress: number;
  filename: string;
  fileId?: string;
  audioUrl?: string;
  createdAt: string;
  optimizationStatus?: string;
  result?: {
    transcript: string;
    segments: TranscriptSegment[];
    speakers: Speaker[];
    duration: number;
  };
  error?: string;
}

export type ExportFormat = 'docx' | 'pdf' | 'txt' | 'srt' | 'vtt';

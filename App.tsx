
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Settings, Play, Image as ImageIcon, Type, Clock, Save, Download, RotateCcw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AppState, TimingConfig, MediaSlotData, TypographyConfig, AnimationConfig } from './types';
import { INITIAL_STATE, TIMING_LABELS } from './constants';
import ControlPanel from './components/ControlPanel';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';

const STORAGE_KEY = 'video_header_gen_v2';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });

  const [isPlaying, setIsPlaying] = useState(false);
  
  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'completed' | 'error'>('idle');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Detect aspect ratios for media that don't have them
  useEffect(() => {
    const slotsToUpdate: Array<{id: keyof AppState['slots'], ratio: number}> = [];
    
    const checkRatios = async () => {
      const entries = Object.entries(state.slots) as [keyof AppState['slots'], MediaSlotData][];
      for (const [id, slot] of entries) {
        if (slot.url && slot.aspectRatio === undefined) {
          try {
            const media = await loadMedia(slot.url, slot.type);
            const ratio = slot.type === 'image' 
              ? (media as HTMLImageElement).width / (media as HTMLImageElement).height
              : (media as HTMLVideoElement).videoWidth / (media as HTMLVideoElement).videoHeight;
            slotsToUpdate.push({ id, ratio });
          } catch (e) {
            console.error(e);
          }
        }
      }
      
      if (slotsToUpdate.length > 0) {
        setState(prev => {
          const newSlots = { ...prev.slots };
          slotsToUpdate.forEach(({ id, ratio }) => {
            newSlots[id] = { ...newSlots[id], aspectRatio: ratio };
          });
          return { ...prev, slots: newSlots };
        });
      }
    };
    
    checkRatios();
  }, []);

  const handleUpdateSlots = (slotId: keyof AppState['slots'], data: Partial<MediaSlotData>) => {
    setState(prev => {
      // Revoke old URL if it's being replaced to prevent memory leaks
      if (data.url && prev.slots[slotId].url && data.url !== prev.slots[slotId].url) {
        // Only revoke if it's a blob URL we created
        if (prev.slots[slotId].url?.startsWith('blob:')) {
          URL.revokeObjectURL(prev.slots[slotId].url!);
        }
      }
      return {
        ...prev,
        slots: { ...prev.slots, [slotId]: { ...prev.slots[slotId], ...data } }
      };
    });
  };

  const handleUpdateTiming = (timing: Partial<TimingConfig>) => {
    setState(prev => ({ ...prev, timing: { ...prev.timing, ...timing } }));
  };

  const handleUpdateTypography = (typography: Partial<TypographyConfig>) => {
    setState(prev => ({ ...prev, typography: { ...prev.typography, ...typography } }));
  };

  const handleUpdateAnimation = (animation: Partial<AnimationConfig>) => {
    setState(prev => ({ ...prev, animation: { ...prev.animation, ...animation } }));
  };

  const totalDuration = useMemo(() => {
    return (Object.values(state.timing) as number[]).reduce((acc, val) => acc + val, 0);
  }, [state.timing]);

  const loadMedia = (url: string, type: 'image' | 'video'): Promise<HTMLImageElement | HTMLVideoElement> => {
    return new Promise((resolve, reject) => {
      if (type === 'image') {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(`Failed to load image: ${url}`);
        img.src = url;
      } else {
        const video = document.createElement('video');
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.playsInline = true;
        video.onloadeddata = () => resolve(video);
        video.onerror = () => reject(`Failed to load video: ${url}`);
        video.src = url;
        video.load();
      }
    });
  };

  const startRecording = async () => {
    if (!canvasRef.current) return;
    
    // Check for WebCodecs support
    if (!window.VideoEncoder) {
      setRenderError("Your browser does not support high-quality WebCodecs recording. Please use Chrome or Edge.");
      setRenderStatus('error');
      return;
    }

    setRenderStatus('rendering');
    setRenderProgress(0);
    setRenderError(null);
    setRecordedUrl(null);
    setIsPlaying(true);

    try {
      const mediaElements = await Promise.all([
        loadMedia(state.slots.a.url || '', state.slots.a.type),
        loadMedia(state.slots.b.url || '', state.slots.b.type),
        loadMedia(state.slots.c.url || '', state.slots.c.type),
        loadMedia(state.slots.d.url || '', state.slots.d.type)
      ]);
      const [mediaA, mediaB, mediaC, mediaD] = mediaElements;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx) throw new Error("Canvas context failed");

      const FPS = 30;
      const totalFrames = Math.ceil(totalDuration * FPS);
      const { timing, slots, typography, animation } = state;

      // Initialize Muxer and Encoder
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'V_VP9',
          width: 1920,
          height: 1080,
          frameRate: FPS
        }
      });

      const videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (e) => {
          console.error('VideoEncoder error:', e);
          setRenderError(`Encoder error: ${e.message}`);
        }
      });

      videoEncoder.configure({
        codec: 'vp09.00.10.08', // VP9 Profile 0, Level 1.0, 8-bit
        width: 1920,
        height: 1080,
        bitrate: 10_000_000, // 10 Mbps
        framerate: FPS,
        latencyMode: 'quality'
      });

      // Pre-calculate media dimensions
      const getMediaDims = (el: HTMLImageElement | HTMLVideoElement, type: 'image' | 'video') => {
        return {
          w: type === 'image' ? (el as HTMLImageElement).width : (el as HTMLVideoElement).videoWidth,
          h: type === 'image' ? (el as HTMLImageElement).height : (el as HTMLVideoElement).videoHeight
        };
      };

      const dimsA = getMediaDims(mediaA, slots.a.type);
      const dimsB = getMediaDims(mediaB, slots.b.type);
      const dimsC = getMediaDims(mediaC, slots.c.type);
      const dimsD = getMediaDims(mediaD, slots.d.type);

      const seekVideo = (video: HTMLVideoElement, startTime: number, endTime: number | undefined, elapsed: number) => {
        return new Promise<void>((resolve) => {
          const effectiveEndTime = endTime || video.duration;
          const segmentDuration = effectiveEndTime - startTime;
          let targetTime = startTime;
          
          if (segmentDuration > 0) {
            targetTime = startTime + (elapsed % segmentDuration);
          }

          if (Math.abs(video.currentTime - targetTime) < 0.01) {
            resolve();
            return;
          }

          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
          };
          video.addEventListener('seeked', onSeeked);
          video.currentTime = targetTime;
        });
      };

      for (let frame = 0; frame <= totalFrames; frame++) {
        const t = frame / FPS; 
        
        if (frame % 5 === 0 || frame === totalFrames) {
          setRenderProgress((frame / totalFrames) * 100);
        }

        const syncPromises = [];
        if (slots.a.type === 'video') syncPromises.push(seekVideo(mediaA as HTMLVideoElement, slots.a.startTime, slots.a.endTime, t));
        if (t >= timing.t1 + timing.t2) {
          const ct = t - (timing.t1 + timing.t2);
          if (slots.b.type === 'video') syncPromises.push(seekVideo(mediaB as HTMLVideoElement, slots.b.startTime, slots.b.endTime, ct));
          if (slots.c.type === 'video') syncPromises.push(seekVideo(mediaC as HTMLVideoElement, slots.c.startTime, slots.c.endTime, ct));
          if (slots.d.type === 'video') syncPromises.push(seekVideo(mediaD as HTMLVideoElement, slots.d.startTime, slots.d.endTime, ct));
        }
        await Promise.all(syncPromises);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 1920, 1080);

        if (t < timing.t1 + timing.t2) {
          const introOpacity = t < timing.t1 ? 1 : Math.max(0, 1 - (t - timing.t1) / timing.t2);
          const kenBurns = 1 + (t / (timing.t1 + timing.t2)) * 0.05;
          ctx.save();
          ctx.globalAlpha = introOpacity;
          const w = 1920 * kenBurns;
          const h = 1080 * kenBurns;
          ctx.drawImage(mediaA as any, (1920 - w) / 2, (1080 - h) / 2, w, h);
          ctx.restore();
        }

        if (t >= timing.t1 + timing.t2) {
          const ct = t - (timing.t1 + timing.t2);
          const panelWidth = 1920 / 3;

          const drawPanel = (
            media: HTMLImageElement | HTMLVideoElement, 
            index: number, 
            xOff: number, 
            yOff: number, 
            scale: number, 
            type: 'image' | 'video',
            dims: { w: number, h: number }
          ) => {
            const mediaAspect = dims.w / dims.h;
            const panelAspect = panelWidth / 1080;
            
            let drawW, drawH;
            if (mediaAspect > panelAspect) {
              drawH = 1080 * scale;
              drawW = drawH * mediaAspect;
            } else {
              drawW = panelWidth * scale;
              drawH = drawW / mediaAspect;
            }

            const overflowX = drawW - panelWidth;
            const imgTargetX = (index * panelWidth) - (overflowX * (xOff / 100));
            const imgTargetY = (1080 - drawH) / 2 + yOff;

            ctx.save();
            ctx.beginPath();
            ctx.rect(index * panelWidth, 0, panelWidth, 1080);
            ctx.clip();
            ctx.drawImage(media as any, imgTargetX, imgTargetY, drawW, drawH);
            ctx.restore();
          };

          const entryProgress = Math.min(ct / timing.t3, 1);
          const getBounce = (delay: number) => {
            const bt = ct - timing.t3 - delay;
            const bDur = timing.t4 / 3;
            if (bt < 0 || bt > bDur) return 1;
            return 1 + Math.sin((bt / bDur) * Math.PI) * (animation.bounceScale - 1);
          };

          ctx.globalAlpha = 1;
          if (ct < timing.t3) {
            const ease = 1 - Math.pow(1 - entryProgress, 3);
            drawPanel(mediaB, 0, slots.b.xOffset, 0, 1, slots.b.type, dimsB);
            drawPanel(mediaC, 1, slots.c.xOffset, 0, 1, slots.c.type, dimsC);
            drawPanel(mediaD, 2, slots.d.xOffset, 0, 1, slots.d.type, dimsD);
            
            ctx.fillStyle = '#000000';
            const offset = panelWidth * (1 - ease);
            ctx.fillRect(0, 0, offset, 1080);
            ctx.fillRect(panelWidth, 0, panelWidth, 1080 * (1 - ease));
            ctx.fillRect(1920 - offset, 0, offset, 1080);
          } else {
            drawPanel(mediaB, 0, slots.b.xOffset, 0, getBounce(0), slots.b.type, dimsB);
            drawPanel(mediaC, 1, slots.c.xOffset, 0, getBounce(timing.t4/3), slots.c.type, dimsC);
            drawPanel(mediaD, 2, slots.d.xOffset, 0, getBounce((timing.t4/3)*2), slots.d.type, dimsD);
          }

          const ot = ct - timing.t3 - timing.t4 - timing.tHold;
          if (ot > 0) {
            const overlayOpacity = Math.min(ot / timing.t5, 1);
            ctx.save();
            ctx.fillStyle = `rgba(0,0,0,${overlayOpacity * 0.4})`;
            ctx.fillRect(0,0,1920,1080);
            ctx.globalAlpha = overlayOpacity;
            ctx.fillStyle = typography.color;
            ctx.font = `bold ${typography.fontSize * 1.5}px ${typography.fontFamily}`;
            ctx.textAlign = typography.align as CanvasTextAlign;
            ctx.textBaseline = 'middle';
            const lines = typography.content.split('\n');
            const lineHeight = typography.fontSize * 1.5;
            const totalTextHeight = lines.length * lineHeight;
            const startY = 540 - (totalTextHeight / 2) + (lineHeight / 2);
            lines.forEach((line, i) => {
              const x = typography.align === 'center' ? 960 : typography.align === 'left' ? 200 : 1720;
              ctx.fillText(line, x, startY + (i * lineHeight));
            });
            ctx.restore();
          }
        }

        // Encode frame
        const frameBitmap = await createImageBitmap(canvas);
        const videoFrame = new VideoFrame(frameBitmap, { timestamp: (frame * 1000000) / FPS });
        videoEncoder.encode(videoFrame, { keyFrame: frame % 60 === 0 });
        videoFrame.close();
        frameBitmap.close();

        await new Promise(r => requestAnimationFrame(r));
      }

      // Finalize
      await videoEncoder.flush();
      videoEncoder.close();
      muxer.finalize();

      const { buffer } = muxer.target as ArrayBufferTarget;
      const blob = new Blob([buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      
      setRecordedUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      
      setRenderStatus('completed');
      setIsPlaying(false);

      // Cleanup media
      mediaElements.forEach(el => {
        if (el instanceof HTMLVideoElement) {
          el.pause();
          el.src = "";
          el.load();
          el.remove();
        }
      });

    } catch (err) {
      console.error(err);
      setRenderError("Recording failed. Check your assets and try again.");
      setRenderStatus('error');
      setIsPlaying(false);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      // Logic to stop if needed, but for now we just let it finish
      return;
    }
    startRecording();
  };

  const downloadVideo = () => {
    if (!recordedUrl) return;
    const a = document.createElement('a');
    a.href = recordedUrl;
    a.download = `header-${Date.now()}.webm`;
    a.click();
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 overflow-hidden text-slate-200">
      <canvas ref={canvasRef} width="1920" height="1080" className="hidden" />
      
      {/* Sidebar - Refined Stacking */}
      <aside className="w-96 bg-slate-900 border-r border-slate-800 flex flex-col h-full overflow-hidden relative z-50">
        {/* Fixed Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 relative z-50 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/10 rounded-lg">
              <Settings className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Sync Video Gen</h1>
          </div>
          <button onClick={() => setState(INITIAL_STATE)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Area - Isolated Stacking Context */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 bg-slate-900/50">
          <ControlPanel 
            state={state}
            onUpdateSlots={handleUpdateSlots}
            onUpdateTiming={handleUpdateTiming}
            onUpdateTypography={handleUpdateTypography}
            onUpdateAnimation={handleUpdateAnimation}
          />
        </div>

        {/* Fixed Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900 relative z-50 shadow-[0_-20px_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-400">Total Duration</span>
            <span className="text-lg font-bold text-blue-400 font-mono tracking-tighter">{totalDuration.toFixed(1)}s</span>
          </div>
          <div className="flex flex-col gap-3">
            {recordedUrl && (
              <button 
                onClick={downloadVideo}
                className="w-full py-3 px-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-xl flex items-center justify-center gap-2 border border-emerald-400/20"
              >
                <Download className="w-5 h-5" />
                Download Last Recording
              </button>
            )}
            <p className="text-[9px] text-slate-500 text-center uppercase font-bold tracking-[0.2em] opacity-50">Recording is automatic during preview</p>
          </div>
        </div>
      </aside>

      {/* Main Preview Area */}
      <main className="flex-1 flex flex-col items-center justify-center bg-[#020617] p-12 relative">
        {renderStatus === 'error' && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-red-500/95 text-white px-6 py-3 rounded-full flex items-center gap-3 z-[100] animate-bounce shadow-2xl">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-bold text-sm">{renderError}</span>
            <button onClick={() => setRenderStatus('idle')} className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs transition-colors">Dismiss</button>
          </div>
        )}
        <div className="w-full max-w-5xl flex flex-col gap-8">
          <div className="flex items-center justify-between px-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Real-time Preview</h2>
              <p className="text-slate-500 text-xs font-medium mt-1 uppercase tracking-widest opacity-60">Visual synchronization feedback</p>
            </div>
            <button 
              onClick={togglePlayback}
              disabled={isPlaying}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all shadow-lg border ${
                isPlaying 
                ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-wait' 
                : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 active:scale-95'
              }`}
            >
              {isPlaying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {isPlaying ? `Recording... ${Math.round(renderProgress)}%` : 'Preview & Record Sequence'}
            </button>
          </div>
          <div className="aspect-video w-full bg-[#000000] rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] border border-slate-800/50 relative flex items-center justify-center">
            <canvas 
              ref={canvasRef} 
              width="1920" 
              height="1080" 
              className="w-full h-full object-contain"
            />
            {!isPlaying && !recordedUrl && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                 <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl shadow-2xl text-center">
                   <div className="text-blue-400 font-bold mb-1 uppercase tracking-widest">Engine Ready</div>
                   <div className="text-slate-500 text-xs">Click Preview & Record to start</div>
                 </div>
              </div>
            )}
            {renderStatus === 'completed' && recordedUrl && !isPlaying && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-950/40 backdrop-blur-sm">
                 <div className="bg-slate-950 border border-emerald-500/30 p-8 rounded-3xl shadow-2xl text-center flex flex-col items-center gap-4">
                   <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                     <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                   </div>
                   <div>
                     <div className="text-white font-bold text-lg">Recording Finished!</div>
                     <div className="text-slate-400 text-sm">Your high-quality WebM is ready for download.</div>
                   </div>
                   <button 
                    onClick={downloadVideo}
                    className="mt-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold transition-all flex items-center gap-2 shadow-lg"
                   >
                     <Download className="w-4 h-4" />
                     Download Video
                   </button>
                 </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;

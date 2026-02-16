
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Settings, Play, Image as ImageIcon, Type, Clock, Save, Download, RotateCcw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AppState, TimingConfig, ImageSlotData, TypographyConfig, AnimationConfig } from './types';
import { INITIAL_STATE, TIMING_LABELS } from './constants';
import PreviewWindow from './components/PreviewWindow';
import ControlPanel from './components/ControlPanel';

const STORAGE_KEY = 'video_header_gen_v2';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  
  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'completed' | 'error'>('idle');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const handleUpdateSlots = (slotId: keyof AppState['slots'], data: Partial<ImageSlotData>) => {
    setState(prev => ({
      ...prev,
      slots: { ...prev.slots, [slotId]: { ...prev.slots[slotId], ...data } }
    }));
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

  const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(`Failed to load image: ${url}`);
      img.src = url;
    });
  };

  const startRecording = async () => {
    if (!canvasRef.current) return;
    setRenderStatus('rendering');
    setRenderProgress(0);
    setRenderError(null);

    try {
      const images = await Promise.all([
        loadImage(state.slots.a.url || ''),
        loadImage(state.slots.b.url || ''),
        loadImage(state.slots.c.url || ''),
        loadImage(state.slots.d.url || '')
      ]);
      const [imgA, imgB, imgC, imgD] = images;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error("Canvas context failed");

      const stream = canvas.captureStream(30); 
      const recorder = new MediaRecorder(stream, { 
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 10000000 
      });
      
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `header-${Date.now()}.webm`;
        a.click();
        setRenderStatus('completed');
        setTimeout(() => setRenderStatus('idle'), 3000);
      };

      recorder.start();

      const FPS = 30;
      const frameDuration = 1000 / FPS; 
      const totalFrames = Math.ceil(totalDuration * FPS);
      const { timing, slots, typography, animation } = state;

      for (let frame = 0; frame <= totalFrames; frame++) {
        const frameStartTime = performance.now();
        const t = frame / FPS; 
        setRenderProgress((frame / totalFrames) * 100);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 1920, 1080);

        if (t < timing.t1 + timing.t2) {
          const introOpacity = t < timing.t1 ? 1 : Math.max(0, 1 - (t - timing.t1) / timing.t2);
          const kenBurns = 1 + (t / (timing.t1 + timing.t2)) * 0.05;
          ctx.save();
          ctx.globalAlpha = introOpacity;
          const w = 1920 * kenBurns;
          const h = 1080 * kenBurns;
          ctx.drawImage(imgA, (1920 - w) / 2, (1080 - h) / 2, w, h);
          ctx.restore();
        }

        if (t >= timing.t1 + timing.t2) {
          const ct = t - (timing.t1 + timing.t2);
          const panelWidth = 1920 / 3;

          const drawPanel = (img: HTMLImageElement, index: number, xOff: number, yOff: number, scale: number) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(index * panelWidth, 0, panelWidth, 1080);
            ctx.clip();
            const drawW = 1920 * scale;
            const drawH = 1080 * scale;
            const centerX = (index * panelWidth) + (panelWidth / 2);
            const imgTargetX = centerX - (drawW * (xOff / 100));
            ctx.drawImage(img, imgTargetX, (1080 - drawH) / 2 + yOff, drawW, drawH);
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
            ctx.save(); ctx.translate(-panelWidth * (1 - ease), 0); drawPanel(imgB, 0, slots.b.xOffset, 0, 1); ctx.restore();
            ctx.save(); ctx.translate(0, -1080 * (1 - ease)); drawPanel(imgC, 1, slots.c.xOffset, 0, 1); ctx.restore();
            ctx.save(); ctx.translate(panelWidth * (1 - ease), 0); drawPanel(imgD, 2, slots.d.xOffset, 0, 1); ctx.restore();
          } else {
            drawPanel(imgB, 0, slots.b.xOffset, 0, getBounce(0));
            drawPanel(imgC, 1, slots.c.xOffset, 0, getBounce(timing.t4/3));
            drawPanel(imgD, 2, slots.d.xOffset, 0, getBounce((timing.t4/3)*2));
          }

          const ot = ct - timing.t3 - timing.t4;
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

        const drawDuration = performance.now() - frameStartTime;
        const waitTime = Math.max(0, frameDuration - drawDuration);
        await new Promise(r => setTimeout(r, waitTime));
      }

      recorder.stop();

    } catch (err) {
      console.error(err);
      setRenderError("Recording failed. Check your images and try again.");
      setRenderStatus('error');
    }
  };

  const togglePlayback = () => {
    setAnimationKey(prev => prev + 1);
    setIsPlaying(!isPlaying);
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
          <button 
            onClick={startRecording}
            disabled={renderStatus === 'rendering'}
            className={`w-full py-3.5 px-4 rounded-xl font-bold transition-all shadow-xl flex items-center justify-center gap-2 border border-blue-400/20 ${
              renderStatus === 'rendering' ? 'bg-slate-700 cursor-wait opacity-50' : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98]'
            }`}
          >
            {renderStatus === 'rendering' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {renderStatus === 'rendering' ? `Exporting... ${Math.round(renderProgress)}%` : 'Export WebM (Synced)'}
          </button>
          <p className="text-[9px] text-slate-500 mt-3 text-center uppercase font-bold tracking-[0.2em] opacity-50">Real-time Encoded 30FPS</p>
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
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all shadow-lg border ${
                isPlaying 
                ? 'bg-rose-500 border-rose-400 text-white active:scale-95' 
                : 'bg-white border-slate-200 text-slate-900 hover:bg-slate-50 active:scale-95'
              }`}
            >
              {isPlaying ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {isPlaying ? 'Reset Engine' : 'Run Preview Sequence'}
            </button>
          </div>
          <div className="aspect-video w-full bg-[#000000] rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] border border-slate-800/50 relative">
            <PreviewWindow state={state} isPlaying={isPlaying} onComplete={() => setIsPlaying(false)} key={animationKey} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;

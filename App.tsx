
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Settings, Play, Image as ImageIcon, Type, Clock, Save, Download, RotateCcw, Loader2, CheckCircle2, AlertTriangle, Zap, X, FastForward } from 'lucide-react';
import { AppState, TimingConfig, MediaSlotData, TypographyConfig, IntroTypographyConfig, AnimationConfig } from './types';
import { INITIAL_STATE, TIMING_LABELS } from './constants';
import ControlPanel from './components/ControlPanel';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { Language, TRANSLATIONS } from './translations';

const STORAGE_KEY = 'video_header_gen_v3';

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('app_lang');
    return (saved as Language) || 'en';
  });
  
  const t = TRANSLATIONS[lang];

  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...INITIAL_STATE,
          timing: parsed.timing || INITIAL_STATE.timing,
          slots: parsed.slots || INITIAL_STATE.slots,
          typography: parsed.typography || INITIAL_STATE.typography,
          introTypography: parsed.introTypography || INITIAL_STATE.introTypography,
          animation: parsed.animation || INITIAL_STATE.animation,
        };
      } catch (e) {
        console.error("Failed to parse saved state", e);
      }
    }
    return INITIAL_STATE;
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [isQuickPreviewing, setIsQuickPreviewing] = useState(false);
  const [quickPreviewProgress, setQuickPreivewProgress] = useState(0);
  const [quickPreviewRes, setQuickPreviewRes] = useState<360 | 720 | 1080>(720);
  
  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'completed' | 'error'>('idle');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [pendingQuality, setPendingQuality] = useState<'standard' | 'high' | null>(null);
  const [lastRecordedQuality, setLastRecordedQuality] = useState<'standard' | 'high' | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const quickPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    const { timing, slots, typography, introTypography, animation } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timing, slots, typography, introTypography, animation }));
    localStorage.setItem('app_lang', lang);
  }, [state.timing, state.slots, state.typography, state.introTypography, state.animation, lang]);

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

  const handleUpdateIntroTypography = (introTypography: Partial<IntroTypographyConfig>) => {
    setState(prev => ({ ...prev, introTypography: { ...prev.introTypography, ...introTypography } }));
  };

  const handleUpdateQuality = (quality: 'standard' | 'high') => {
    if (state.quality === quality) return;

    if (recordedUrl) {
      setPendingQuality(quality);
    } else {
      setState(prev => ({ ...prev, quality }));
    }
  };

  const confirmQualityChange = () => {
    if (pendingQuality) {
      setState(prev => ({ ...prev, quality: pendingQuality }));
      setRecordedUrl(null);
      setRenderStatus('idle');
      setRenderProgress(0);
      setPendingQuality(null);
    }
  };

  const totalDuration = useMemo(() => {
    return (Object.values(state.timing) as number[]).reduce((acc, val) => acc + val, 0);
  }, [state.timing]);

  const seekVideo = (video: HTMLVideoElement, startTime: number, endTime: number | undefined, loop: boolean | undefined, elapsed: number) => {
    return new Promise<void>((resolve) => {
      let effectiveEndTime = endTime || video.duration;
      if (effectiveEndTime === Infinity || isNaN(effectiveEndTime)) effectiveEndTime = startTime + 60;
      const segmentDuration = effectiveEndTime - startTime;
      let targetTime = startTime;
      if (segmentDuration > 0) {
        if (loop !== false) targetTime = startTime + (elapsed % segmentDuration);
        else targetTime = Math.min(startTime + elapsed, effectiveEndTime);
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

  const drawScene = (
    ctx: CanvasRenderingContext2D,
    t: number,
    state: AppState,
    media: { a: any; b: any; c: any; d: any },
    dims: { a: any; b: any; c: any; d: any },
    canvasW = 1920,
    canvasH = 1080
  ) => {
    const { timing, slots, typography, animation } = state;
    const scale = canvasW / 1920;
    
    const drawTypography = (config: TypographyConfig, opacity: number) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = config.color;
      const scaledSize = config.fontSize * 1.5 * scale;
      ctx.font = `bold ${scaledSize}px ${config.fontFamily}`;
      ctx.textAlign = config.align as CanvasTextAlign;
      ctx.textBaseline = 'middle';
      const lines = config.content.split('\n');
      const lineHeight = scaledSize;
      const totalTextHeight = lines.length * lineHeight;
      const startY = (canvasH / 2) - (totalTextHeight / 2) + (lineHeight / 2);
      lines.forEach((line, i) => {
        const x = config.align === 'center' ? (canvasW / 2) : config.align === 'left' ? 200 * scale : (canvasW - 200 * scale);
        ctx.fillText(line, x, startY + (i * lineHeight));
      });
      ctx.restore();
    };

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Intro Phase
    if (t < timing.t1 + timing.t2) {
      const introOpacity = t < timing.t1 ? 1 : Math.max(0, 1 - (t - timing.t1) / timing.t2);
      const kenBurns = 1 + (t / (timing.t1 + timing.t2)) * 0.05;
      ctx.save();
      ctx.globalAlpha = introOpacity;
      
      const mediaAspect = dims.a.w / dims.a.h;
      const targetAspect = canvasW / canvasH;
      let drawW, drawH;
      if (mediaAspect > targetAspect) {
        drawH = canvasH * kenBurns;
        drawW = drawH * mediaAspect;
      } else {
        drawW = canvasW * kenBurns;
        drawH = drawW / mediaAspect;
      }

      ctx.drawImage(media.a, (canvasW - drawW) / 2, (canvasH - drawH) / 2, drawW, drawH);
      ctx.restore();
    }

    // Panels Phase
    if (t >= timing.t1 + timing.t2) {
      const ct = t - (timing.t1 + timing.t2);
      const panelWidth = canvasW / 3;
      
      const drawPanel = (
        el: any, 
        index: number, 
        xOff: number, 
        yOff: number, 
        scale: number, 
        pDims: { w: number, h: number },
        xTranslate: number = 0,
        yTranslate: number = 0
      ) => {
        const mediaAspect = pDims.w / pDims.h;
        const panelAspect = panelWidth / canvasH;
        
        let dW, dH;
        if (mediaAspect > panelAspect) {
          dH = canvasH * scale;
          dW = dH * mediaAspect;
        } else {
          dW = panelWidth * scale;
          dH = dW / mediaAspect;
        }

        const overflowX = dW - panelWidth;
        const imgTargetX = (index * panelWidth) - (overflowX * (xOff / 100)) + xTranslate;
        const imgTargetY = (canvasH - dH) / 2 + yOff + yTranslate;

        ctx.save();
        ctx.beginPath();
        ctx.rect(index * panelWidth + xTranslate, yTranslate, panelWidth, canvasH);
        ctx.clip();
        ctx.drawImage(el, imgTargetX, imgTargetY, dW, dH);
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
        if (animation.entryType === 'sequential') {
          const stagger = 0.15;
          const durationPerPanel = timing.t3 - (stagger * 2);
          const getPanelEase = (idx: number) => {
            const start = idx * stagger;
            const progress = Math.max(0, Math.min((ct - start) / durationPerPanel, 1));
            return 1 - Math.pow(1 - progress, 3);
          };
          drawPanel(media.b, 0, slots.b.xOffset, 0, 1, dims.b, -panelWidth * (1 - getPanelEase(0)));
          drawPanel(media.c, 1, slots.c.xOffset, 0, 1, dims.c, -panelWidth * 2 * (1 - getPanelEase(1)));
          drawPanel(media.d, 2, slots.d.xOffset, 0, 1, dims.d, -panelWidth * 3 * (1 - getPanelEase(2)));
        } else if (animation.entryType === 'staggered') {
          drawPanel(media.b, 0, slots.b.xOffset, 0, 1, dims.b, -panelWidth * (1 - ease));
          drawPanel(media.c, 1, slots.c.xOffset, 0, 1, dims.c, (canvasW - panelWidth) * (1 - ease));
          drawPanel(media.d, 2, slots.d.xOffset, 0, 1, dims.d, -canvasW * (1 - ease));
        } else {
          drawPanel(media.b, 0, slots.b.xOffset, 0, 1, dims.b);
          drawPanel(media.c, 1, slots.c.xOffset, 0, 1, dims.c);
          drawPanel(media.d, 2, slots.d.xOffset, 0, 1, dims.d);
          ctx.fillStyle = '#000000';
          const offset = panelWidth * (1 - ease);
          ctx.fillRect(0, 0, offset, canvasH);
          ctx.fillRect(panelWidth, 0, panelWidth, canvasH * (1 - ease));
          ctx.fillRect(canvasW - offset, 0, offset, canvasH);
        }
      } else {
        drawPanel(media.b, 0, slots.b.xOffset, 0, getBounce(0), dims.b);
        drawPanel(media.c, 1, slots.c.xOffset, 0, getBounce(timing.t4/3), dims.c);
        drawPanel(media.d, 2, slots.d.xOffset, 0, getBounce((timing.t4/3)*2), dims.d);
      }
      
      const ot = ct - timing.t3 - timing.t4 - timing.tHold;
      if (ot > 0) {
        const overlayOpacity = Math.min(ot / timing.t5, 1);
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${overlayOpacity * 0.4})`;
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.restore();
        drawTypography(typography, overlayOpacity);
      }
    }

    // Intro Typography (Stay visible on top)
    const { introTypography } = state;
    if (introTypography.enabled && t >= introTypography.startTime && t <= introTypography.endTime) {
      let opacity = 1;
      const elapsed = t - introTypography.startTime;
      const remaining = introTypography.endTime - t;
      if (elapsed < introTypography.fadeDuration) opacity = elapsed / introTypography.fadeDuration;
      else if (remaining < introTypography.fadeDuration) opacity = remaining / introTypography.fadeDuration;
      drawTypography(introTypography, opacity);
    }

    // Final Fade
    const fadeOutStartTime = totalDuration - timing.t7;
    if (t > fadeOutStartTime) {
      const progress = (t - fadeOutStartTime) / timing.t7;
      ctx.save();
      ctx.globalAlpha = Math.min(progress, 1);
      ctx.fillStyle = animation.fadeColor === 'white' ? '#FFFFFF' : '#000000';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  };

  const loadMedia = (url: string, type: 'image' | 'video'): Promise<HTMLImageElement | HTMLVideoElement> => {
    return new Promise((resolve, reject) => {
      if (!url) {
        return reject("Media URL is empty");
      }
      const isBlob = url.startsWith('blob:');
      if (type === 'image') {
        const img = new Image();
        if (!isBlob) img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => {
          console.error("Image load error:", e, url);
          reject(`Failed to load image: ${url}`);
        };
        img.src = url;
      } else {
        const video = document.createElement('video');
        if (!isBlob) video.crossOrigin = "anonymous";
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        
        const onReady = () => {
          if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
            video.removeEventListener('loadeddata', onReady);
            video.removeEventListener('durationchange', onReady);
            video.removeEventListener('error', onError);
            resolve(video);
          }
        };

        const onError = (e: any) => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('durationchange', onReady);
          video.removeEventListener('error', onError);
          console.error("Video load error event:", e);
          const error = video.error;
          let msg = `Failed to load video: ${url}`;
          if (error) {
            msg += ` (Code: ${error.code}, Message: ${error.message})`;
          }
          reject(msg);
        };

        video.addEventListener('loadeddata', onReady);
        video.addEventListener('durationchange', onReady);
        video.addEventListener('error', onError);
        video.src = url;
        video.load();
      }
    });
  };

  const startRecording = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setRenderError(t.canvasError);
      setRenderStatus('error');
      return;
    }
    
    // Check for WebCodecs support
    if (!window.VideoEncoder) {
      setRenderError(t.browserWarning);
      setRenderStatus('error');
      return;
    }

    setRenderStatus('rendering');
    setRenderProgress(0);
    setRenderError(null);
    setRecordedUrl(null);
    setIsPlaying(true);
    setLastRecordedQuality(state.quality);
    stopRequestedRef.current = false;

    let videoEncoder: VideoEncoder | undefined;
    let mediaElements: (HTMLImageElement | HTMLVideoElement)[] | undefined;

    try {
      mediaElements = await Promise.all([
        loadMedia(state.slots.a.url || '', state.slots.a.type),
        loadMedia(state.slots.b.url || '', state.slots.b.type),
        loadMedia(state.slots.c.url || '', state.slots.c.type),
        loadMedia(state.slots.d.url || '', state.slots.d.type)
      ]);
      const [mediaA, mediaB, mediaC, mediaD] = mediaElements;

      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx) throw new Error("Canvas context failed");

      const isHighQuality = state.quality === 'high';
      const FPS = isHighQuality ? 60 : 30;
      const bitrate = isHighQuality ? 20_000_000 : 10_000_000;
      
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

      videoEncoder = new VideoEncoder({
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
        bitrate: bitrate,
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

      const mediaMap = { a: mediaA, b: mediaB, c: mediaC, d: mediaD };
      const dimsMap = { a: dimsA, b: dimsB, c: dimsC, d: dimsD };

      const seekVideo = (video: HTMLVideoElement, startTime: number, endTime: number | undefined, loop: boolean | undefined, elapsed: number) => {
        return new Promise<void>((resolve) => {
          let effectiveEndTime = endTime || video.duration;
          if (effectiveEndTime === Infinity || isNaN(effectiveEndTime)) effectiveEndTime = startTime + 60;
          const segmentDuration = effectiveEndTime - startTime;
          let targetTime = startTime;
          if (segmentDuration > 0) {
            if (loop !== false) targetTime = startTime + (elapsed % segmentDuration);
            else targetTime = Math.min(startTime + elapsed, effectiveEndTime);
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
        if (stopRequestedRef.current) {
          throw new Error("Recording stopped by user");
        }
        const t = frame / FPS; 
        
        if (frame % 5 === 0 || frame === totalFrames) {
          setRenderProgress((frame / totalFrames) * 100);
        }

        const syncPromises = [];
        // Optimization: Only seek mediaA if it's visible (Intro + Transition)
        if (slots.a.type === 'video' && t < timing.t1 + timing.t2) {
          syncPromises.push(seekVideo(mediaA as HTMLVideoElement, slots.a.startTime, slots.a.endTime, slots.a.loop, t));
        }
        
        // Optimization: Only seek panels if they are visible
        if (t >= timing.t1) {
          const ct = t - (timing.t1 + timing.t2);
          if (slots.b.type === 'video') syncPromises.push(seekVideo(mediaB as HTMLVideoElement, slots.b.startTime, slots.b.endTime, slots.b.loop, ct));
          if (slots.c.type === 'video') syncPromises.push(seekVideo(mediaC as HTMLVideoElement, slots.c.startTime, slots.c.endTime, slots.c.loop, ct));
          if (slots.d.type === 'video') syncPromises.push(seekVideo(mediaD as HTMLVideoElement, slots.d.startTime, slots.d.endTime, slots.d.loop, ct));
        }
        await Promise.all(syncPromises);

        drawScene(ctx, t, state, mediaMap, dimsMap);

        // Encode frame
        const videoFrame = new VideoFrame(canvas, { timestamp: (frame * 1000000) / FPS });
        videoEncoder.encode(videoFrame, { keyFrame: frame % 60 === 0 });
        videoFrame.close();

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

    } catch (err: any) {
      if (err.message === "Recording stopped by user") {
        console.log("Preview stopped by user");
        setRenderStatus('idle');
      } else {
        console.error("Recording error:", err);
        setRenderError("Recording failed. Check your assets and try again.");
        setRenderStatus('error');
      }
      setIsPlaying(false);
      
      // Cleanup on error/stop
      if (typeof videoEncoder !== 'undefined' && videoEncoder.state !== 'closed') {
        videoEncoder.close();
      }
    } finally {
      // Ensure media cleanup happens regardless of success or failure
      if (mediaElements) {
        mediaElements.forEach(el => {
          if (el instanceof HTMLVideoElement) {
            el.pause();
            el.src = "";
            el.load();
            el.remove();
          }
        });
      }
    }
  };

  const startQuickPreview = async () => {
    if (isPlaying || renderStatus === 'rendering') return;
    
    setRenderProgress(0);
    setRenderError(null);
    setIsQuickPreviewing(true);
    setQuickPreivewProgress(0);
    stopRequestedRef.current = false;

    let mediaElements: (HTMLImageElement | HTMLVideoElement)[] | undefined;
    const runningRef = { current: true };

    try {
      mediaElements = await Promise.all([
        loadMedia(state.slots.a.url || '', state.slots.a.type),
        loadMedia(state.slots.b.url || '', state.slots.b.type),
        loadMedia(state.slots.c.url || '', state.slots.c.type),
        loadMedia(state.slots.d.url || '', state.slots.d.type)
      ]);
      const [mediaA, mediaB, mediaC, mediaD] = mediaElements;

      const getMediaDims = (el: HTMLImageElement | HTMLVideoElement, type: 'image' | 'video') => ({
        w: type === 'image' ? (el as HTMLImageElement).width : (el as HTMLVideoElement).videoWidth,
        h: type === 'image' ? (el as HTMLImageElement).height : (el as HTMLVideoElement).videoHeight
      });

      const mediaMap = { a: mediaA, b: mediaB, c: mediaC, d: mediaD };
      const dimsMap = {
        a: getMediaDims(mediaA, state.slots.a.type),
        b: getMediaDims(mediaB, state.slots.b.type),
        c: getMediaDims(mediaC, state.slots.c.type),
        d: getMediaDims(mediaD, state.slots.d.type)
      };

      const canvas = quickPreviewCanvasRef.current;
      if (!canvas) throw new Error("Preview canvas not ready");
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error("Context failed");

      // Set smoothing off for faster low-res blitting
      ctx.imageSmoothingEnabled = false;

      const startTime = performance.now();
      let lastProgressUpdate = 0;
      
      // Start Intro video if applicable
      if (state.slots.a.type === 'video') {
        const vA = mediaA as HTMLVideoElement;
        vA.currentTime = state.slots.a.startTime;
        vA.play().catch(e => console.warn("Auto-play failed", e));
      }

      const renderLoop = async () => {
        if (stopRequestedRef.current || !runningRef.current) return;
        
        const now = performance.now();
        const t = (now - startTime) / 1000;
        
        if (t > totalDuration) {
          setIsQuickPreviewing(false);
          runningRef.current = false;
          return;
        }

        if (now - lastProgressUpdate > 100) {
          setQuickPreivewProgress((t / totalDuration) * 100);
          lastProgressUpdate = now;
        }

        const syncVideo = (video: HTMLVideoElement, start: number, end: number | undefined, loop: boolean | undefined, elapsed: number) => {
          let effEnd = end || video.duration;
          if (effEnd === Infinity || isNaN(effEnd)) effEnd = start + 60;
          const segDur = effEnd - start;
          
          let target = start;
          if (segDur > 0) {
            if (loop !== false) {
              target = start + (elapsed % segDur);
            } else {
              target = Math.min(start + elapsed, effEnd);
            }
          }
          
          // Ensure video is playing
          if (video.paused && target < effEnd) {
            video.play().catch(() => {});
          } else if (target >= effEnd && !loop) {
            video.pause();
          }

          // ONLY seek if drift is significant (> 0.3s) or if target is behind currentTime (looping back)
          // This allows the browser to use its native smooth playback most of the time.
          const drift = Math.abs(video.currentTime - target);
          if (drift > 0.3 || (loop !== false && target < video.currentTime - 0.1)) {
            video.currentTime = target;
          }
        };

        if (state.slots.a.type === 'video' && t < state.timing.t1 + state.timing.t2) {
          syncVideo(mediaA as HTMLVideoElement, state.slots.a.startTime, state.slots.a.endTime, state.slots.a.loop, t);
        } else if (state.slots.a.type === 'video') {
          (mediaA as HTMLVideoElement).pause();
        }

        if (t >= state.timing.t1) {
          const ct = t - (state.timing.t1 + state.timing.t2);
          if (ct > 0) {
            if (state.slots.b.type === 'video') syncVideo(mediaB as HTMLVideoElement, state.slots.b.startTime, state.slots.b.endTime, state.slots.b.loop, ct);
            if (state.slots.c.type === 'video') syncVideo(mediaC as HTMLVideoElement, state.slots.c.startTime, state.slots.c.endTime, state.slots.c.loop, ct);
            if (state.slots.d.type === 'video') syncVideo(mediaD as HTMLVideoElement, state.slots.d.startTime, state.slots.d.endTime, state.slots.d.loop, ct);
          }
        }

        drawScene(
          ctx, 
          t, 
          state, 
          mediaMap, 
          dimsMap, 
          quickPreviewRes === 1080 ? 1920 : quickPreviewRes === 720 ? 1280 : 640, 
          quickPreviewRes === 1080 ? 1080 : quickPreviewRes === 720 ? 720 : 360
        );
        
        if (runningRef.current) {
          requestAnimationFrame(renderLoop);
        }
      };

      requestAnimationFrame(renderLoop);
      
      while (runningRef.current && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }

    } catch (err: any) {
      console.error("Quick preview error:", err);
      setRenderError(err.toString());
      setRenderStatus('error');
    } finally {
      setIsQuickPreviewing(false);
      runningRef.current = false;
      if (mediaElements) {
        mediaElements.forEach(el => {
          if (el instanceof HTMLVideoElement) {
            el.pause();
            el.src = "";
            el.load();
            el.remove();
          }
        });
      }
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      stopRequestedRef.current = true;
      return;
    }
    
    if (!canvasRef.current) {
      console.error("Canvas ref is null at togglePlayback");
      setRenderError(t.canvasError);
      setRenderStatus('error');
      return;
    }

    startRecording();
  };

  const toggleLang = () => {
    setLang(prev => prev === 'en' ? 'zh' : 'en');
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
      
      {/* Sidebar - Refined Stacking */}
      <aside className="w-96 bg-slate-900 border-r border-slate-800 flex flex-col h-full overflow-hidden relative z-50">
        {/* Fixed Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 relative z-50 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/10 rounded-lg">
              <Settings className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">{t.appTitle}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={toggleLang}
              className="px-2 py-1 rounded border border-slate-800 text-[9px] font-bold text-slate-500 hover:text-white hover:border-slate-600 transition-all uppercase tracking-widest"
              title={lang === 'en' ? '切換至中文' : 'Switch to English'}
            >
              {lang === 'en' ? '中' : 'EN'}
            </button>
            <button onClick={() => setState(INITIAL_STATE)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Area - Isolated Stacking Context */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 bg-slate-900/50">
          <ControlPanel 
            state={state}
            onUpdateSlots={handleUpdateSlots}
            onUpdateTiming={handleUpdateTiming}
            onUpdateTypography={handleUpdateTypography}
            onUpdateAnimation={handleUpdateAnimation}
            onUpdateIntroTypography={handleUpdateIntroTypography}
            onUpdateQuality={handleUpdateQuality}
            hasRecording={!!recordedUrl}
            lang={lang}
            t={t}
          />
        </div>

        {/* Fixed Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900 relative z-50 shadow-[0_-20px_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-400">{t.totalDuration}</span>
            <span className="text-lg font-bold text-blue-400 font-mono tracking-tighter">{totalDuration.toFixed(1)}s</span>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button 
                onClick={() => setQuickPreviewRes(1080)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all ${quickPreviewRes === 1080 ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                1080p
              </button>
              <button 
                onClick={() => setQuickPreviewRes(720)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all ${quickPreviewRes === 720 ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                720p
              </button>
              <button 
                onClick={() => setQuickPreviewRes(360)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all ${quickPreviewRes === 360 ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                360p
              </button>
            </div>
            <button 
              onClick={startQuickPreview}
              disabled={isPlaying || renderStatus === 'rendering'}
              className="w-full py-3 px-4 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all shadow-xl flex items-center justify-center gap-2 border border-indigo-400/20"
            >
              <FastForward className="w-5 h-5" />
              {t.quickPreview}
            </button>
            {recordedUrl && (
              <button 
                onClick={downloadVideo}
                className="w-full py-3 px-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-xl flex items-center justify-center gap-2 border border-emerald-400/20"
              >
                <Download className="w-5 h-5" />
                {t.downloadVideo}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Preview Area */}
      <main className="flex-1 flex flex-col items-center justify-center bg-[#020617] p-12 relative">
        {isQuickPreviewing && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-8 animate-in fade-in duration-300">
            <div className="max-w-5xl w-full flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-500/20 rounded-2xl">
                    <FastForward className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white tracking-tight">{t.quickPreview}</h3>
                    <p className="text-slate-400 text-sm font-medium uppercase tracking-[0.2em] opacity-70">{t.previewing} {Math.round(quickPreviewProgress)}%</p>
                  </div>
                </div>
                <button 
                  onClick={() => { stopRequestedRef.current = true; setIsQuickPreviewing(false); }}
                  className="p-3 hover:bg-slate-800 rounded-2xl text-slate-400 transition-all hover:text-white group"
                >
                  <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
                </button>
              </div>
              
              <div className="aspect-video w-full bg-black rounded-[2.5rem] overflow-hidden shadow-[0_0_120px_rgba(79,70,229,0.3)] border border-indigo-500/30 ring-1 ring-white/10 relative">
                <canvas 
                  ref={quickPreviewCanvasRef}
                  width={quickPreviewRes === 1080 ? "1920" : quickPreviewRes === 720 ? "1280" : "640"}
                  height={quickPreviewRes === 1080 ? "1080" : quickPreviewRes === 720 ? "720" : "360"}
                  className="w-full h-full object-contain"
                />
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-10">
                   <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500 transition-all duration-300" 
                        style={{ width: `${quickPreviewProgress}%` }}
                      />
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {renderStatus === 'error' && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-red-500/95 text-white px-6 py-3 rounded-full flex items-center gap-3 z-[100] animate-bounce shadow-2xl">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-bold text-sm">{renderError}</span>
            <button onClick={() => setRenderStatus('idle')} className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs transition-colors">{t.dismiss}</button>
          </div>
        )}
        <div className="w-full max-w-5xl flex flex-col gap-8">
          <div className="flex items-center justify-between px-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{t.realTimePreview}</h2>
              <p className="text-slate-500 text-xs font-medium mt-1 uppercase tracking-widest opacity-60">{t.visualSync}</p>
            </div>
            <button 
              onClick={togglePlayback}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all shadow-lg border ${
                isPlaying 
                ? 'bg-rose-600 border-rose-500 text-white hover:bg-rose-500 active:scale-95' 
                : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 active:scale-95'
              }`}
            >
              {isPlaying ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {isPlaying ? `${t.stopPreview} (${Math.round(renderProgress)}%)` : t.previewRecord}
            </button>
          </div>
            {/* Main Preview Area */}
            <div key="canvas-container" className="aspect-video w-full bg-[#000000] rounded-3xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] border border-slate-800/50 relative flex items-center justify-center">
              {/* Quality Change Hint */}
              {!isPlaying && !recordedUrl && renderStatus === 'idle' && lastRecordedQuality !== null && state.quality !== lastRecordedQuality && (
                <div className="absolute top-4 right-4 z-[60] bg-blue-600/90 backdrop-blur-md text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-xl border border-blue-400/30 animate-in fade-in slide-in-from-top-2">
                  {t.qualityChanged}
                </div>
              )}
              <canvas 
                key="main-preview-canvas"
                ref={canvasRef} 
                width="1920" 
                height="1080" 
                className="w-full h-full object-contain"
              />
            {!isPlaying && !recordedUrl && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                 <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl shadow-2xl text-center">
                   <div className="text-blue-400 font-bold mb-1 uppercase tracking-widest">{t.engineReady}</div>
                   <div className="text-slate-500 text-xs">{t.clickToStart}</div>
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
                     <div className="text-white font-bold text-lg">{t.completed}</div>
                     <div className="text-slate-400 text-sm">{t.videoReady}</div>
                   </div>
                   <button 
                    onClick={downloadVideo}
                    className="mt-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold transition-all flex items-center gap-2 shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    {t.downloadVideo}
                  </button>
                 </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Global Quality Confirmation Modal - Highest Z-Index */}
      {pendingQuality && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.8)] max-w-sm w-full animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-6">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
            <h4 className="text-white font-bold text-xl mb-3">{t.confirmQualityChange}</h4>
            <p className="text-slate-400 text-sm mb-8 leading-relaxed">
              {t.qualityChangeWarning}
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setPendingQuality(null)}
                className="flex-1 py-3 rounded-2xl font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all active:scale-95"
              >
                {t.cancel}
              </button>
              <button 
                onClick={confirmQualityChange}
                className="flex-1 py-3 rounded-2xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-900/20 active:scale-95"
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
